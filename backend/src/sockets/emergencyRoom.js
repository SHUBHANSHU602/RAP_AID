const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const EmergencySession = require('../models/EmergencySession');
const { haversineDistance, getSingleETA } = require('../services/mapsService');
const redis = require('../config/redis');
const logger = require('../utils/logger');

let io;

// Track active ETA intervals: sessionId → intervalId
// Stored in memory — lives as long as the server process
const etaIntervals = new Map();

function extractSocketToken(socket) {
  const authHeader = socket.handshake.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const authToken = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (typeof authToken === 'string') {
    return authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken;
  }

  return null;
}

function initSocket(server) {
  const { Server } = require('socket.io');
  const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:3000';
  io = new Server(server, {
    cors: {
      origin: allowedOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  const wss = new WebSocketServer({ server, path: '/' });
  wss.on('connection', (socket, req) => {
    try {
      const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : null;

      if (!token) {
        socket.close(1008, 'Authentication required');
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
      socket.user = decoded;
      logger.info(`Raw WebSocket connected: ${decoded.userId || decoded.sub}`);
      socket.send(JSON.stringify({
        type: 'connected',
        userId: decoded.userId,
        role: decoded.role,
        message: 'WebSocket authentication succeeded',
      }));
    } catch (err) {
      logger.warn('Raw WebSocket authentication failed', err);
      socket.close(1008, 'Invalid token');
    }
  });

  // JWT middleware — rejects unauthenticated sockets before connection opens
  io.use((socket, next) => {
    const token = extractSocketToken(socket);
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} | user: ${socket.user.userId}`);

    // ── Patient joins session room ──────────────────────────────────────────
    socket.on('join_session', async ({ sessionId }) => {
      try {
        const session = await EmergencySession.findById(sessionId).lean();
        if (!session) return socket.emit('error', { message: 'Session not found' });

        const isOwner = session.userId.toString() === socket.user.userId;
        const isAdmin = socket.user.role === 'admin';
        if (!isOwner && !isAdmin) {
          return socket.emit('error', { message: 'Not authorized' });
        }

        socket.join(`session:${sessionId}`);
        socket.emit('joined_session', { sessionId });
        logger.info(`Patient ${socket.user.userId} joined room session:${sessionId}`);
      } catch (err) {
        logger.error('join_session error', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // ── Driver joins session room ───────────────────────────────────────────
    socket.on('join_as_driver', async ({ sessionId }) => {
      try {
        if (socket.user.role !== 'driver' && socket.user.role !== 'admin') {
          return socket.emit('error', { message: 'Driver role required' });
        }

        const session = await EmergencySession.findById(sessionId).lean();
        if (!session) return socket.emit('error', { message: 'Session not found' });

        socket.join(`session:${sessionId}`);
        socket.currentSessionId = sessionId;

        // Store patient location on socket for ETA calculations
        socket.patientLocation = {
          latitude: session.location.coordinates[1],
          longitude: session.location.coordinates[0],
        };

        socket.emit('joined_as_driver', { sessionId });
        logger.info(`Driver ${socket.user.userId} joined room session:${sessionId}`);

        // ── Start ETA recalculation interval ───────────────────────────────
        startETAInterval(socket, sessionId);
      } catch (err) {
        logger.error('join_as_driver error', err);
        socket.emit('error', { message: 'Failed to join as driver' });
      }
    });

    // ── Driver location update with delta compression ───────────────────────
    socket.on('location_update', async ({ latitude, longitude }) => {
      try {
        if (socket.user.role !== 'driver' && socket.user.role !== 'admin') {
          return socket.emit('error', { message: 'Driver role required' });
        }

        if (!socket.currentSessionId) {
          return socket.emit('error', { message: 'Join a session first' });
        }

        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          latitude < -90 || latitude > 90 ||
          longitude < -180 || longitude > 180
        ) {
          return socket.emit('error', { message: 'Invalid coordinates' });
        }

        const ambulanceKey = `ambulance:${socket.user.userId}:location`;

        const lastRaw = await redis.get(ambulanceKey);
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          const distanceKm = haversineDistance(
            last.latitude, last.longitude,
            latitude, longitude
          );
          if (distanceKm * 1000 < 10) {
            logger.debug(`Delta compression: driver ${socket.user.userId} moved ${(distanceKm * 1000).toFixed(1)}m — skipped`);
            return;
          }
        }

        const locationData = { latitude, longitude, timestamp: new Date().toISOString() };
        await redis.set(ambulanceKey, JSON.stringify(locationData), 'EX', 300);

        // Update cached driver location on socket so ETA interval uses fresh coords
        socket.driverLocation = { latitude, longitude };

        io.to(`session:${socket.currentSessionId}`).emit('driver_location', {
          driverId: socket.user.userId,
          latitude,
          longitude,
          timestamp: locationData.timestamp,
        });

        logger.debug(`Driver ${socket.user.userId} location broadcast → session:${socket.currentSessionId}`);
      } catch (err) {
        logger.error('location_update error', err);
        socket.emit('error', { message: 'Failed to process location update' });
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id} | user: ${socket.user.userId}`);
      // Stop ETA interval if this was a driver
      if (socket.currentSessionId) {
        stopETAInterval(socket.currentSessionId);
      }
    });
  });

  return io;
}

// ── ETA interval helpers ────────────────────────────────────────────────────

function startETAInterval(socket, sessionId) {
  // Prevent duplicate intervals for the same session
  if (etaIntervals.has(sessionId)) {
    clearInterval(etaIntervals.get(sessionId));
  }

  const intervalId = setInterval(async () => {
    try {
      // Need driver's current location — read from socket or Redis
      const driverLoc = socket.driverLocation ||
        await getDriverLocationFromRedis(socket.user.userId);

      if (!driverLoc) {
        logger.debug(`ETA interval: no driver location yet for session ${sessionId}`);
        return;
      }

      const { latitude: dLat, longitude: dLng } = driverLoc;
      const { latitude: pLat, longitude: pLng } = socket.patientLocation;

      const etaMinutes = await getSingleETA(dLat, dLng, pLat, pLng);

      // Store in Redis with 90s TTL — slightly longer than the 30s interval
      // so the value is always fresh but expires if the interval stops
      const etaKey = `session:${sessionId}:eta`;
      await redis.set(etaKey, JSON.stringify({
        etaMinutes,
        calculatedAt: new Date().toISOString(),
      }), 'EX', 90);

      // Broadcast updated ETA to session room
      io.to(`session:${sessionId}`).emit('eta_update', {
        sessionId,
        etaMinutes,
        calculatedAt: new Date().toISOString(),
      });

      logger.debug(`ETA updated: session ${sessionId} → ${etaMinutes} min`);
    } catch (err) {
      logger.error(`ETA interval error for session ${sessionId}`, err);
    }
  }, 30000); // 30 seconds

  etaIntervals.set(sessionId, intervalId);
  logger.info(`ETA interval started for session ${sessionId}`);
}

function stopETAInterval(sessionId) {
  if (etaIntervals.has(sessionId)) {
    clearInterval(etaIntervals.get(sessionId));
    etaIntervals.delete(sessionId);
    logger.info(`ETA interval stopped for session ${sessionId}`);
  }
}

async function getDriverLocationFromRedis(userId) {
  const raw = await redis.get(`ambulance:${userId}:location`);
  return raw ? JSON.parse(raw) : null;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

module.exports = { initSocket, getIO, extractSocketToken };