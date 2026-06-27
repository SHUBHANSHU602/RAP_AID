// sockets/emergencyRoom.js
const jwt = require('jsonwebtoken');
const EmergencySession = require('../models/EmergencySession');
const { haversineDistance } = require('../services/mapsService');
const redis = require('../config/redis');
const logger = require('../utils/logger');

let io;

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      methods: ['GET', 'POST'],
    },
  });

  // JWT middleware — runs before any connection is established
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { userId, role }
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

        // Ownership check — only the session owner or admin
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
        // Store sessionId on socket object for use in location_update
        socket.currentSessionId = sessionId;
        socket.emit('joined_as_driver', { sessionId });
        logger.info(`Driver ${socket.user.userId} joined room session:${sessionId}`);
      } catch (err) {
        logger.error('join_as_driver error', err);
        socket.emit('error', { message: 'Failed to join as driver' });
      }
    });

    // ── Driver location update with delta compression ───────────────────────
    socket.on('location_update', async ({ latitude, longitude }) => {
      try {
        // Guard: only drivers can emit location
        if (socket.user.role !== 'driver' && socket.user.role !== 'admin') {
          return socket.emit('error', { message: 'Driver role required' });
        }

        // Guard: driver must be in a session room
        if (!socket.currentSessionId) {
          return socket.emit('error', { message: 'Join a session first' });
        }

        // Validate coordinates
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          latitude < -90 || latitude > 90 ||
          longitude < -180 || longitude > 180
        ) {
          return socket.emit('error', { message: 'Invalid coordinates' });
        }

        const ambulanceKey = `ambulance:${socket.user.userId}:location`;

        // ── Delta compression: read last known location from Redis ──
        const lastRaw = await redis.get(ambulanceKey);
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          const distanceKm = haversineDistance(
            last.latitude, last.longitude,
            latitude, longitude
          );
          const distanceMeters = distanceKm * 1000;

          // If moved less than 10 meters — skip update entirely
          if (distanceMeters < 10) {
            logger.debug(
              `Delta compression: driver ${socket.user.userId} moved ${distanceMeters.toFixed(1)}m — skipped`
            );
            return; // silent ignore
          }
        }

        // ── Moved ≥10m — update Redis and broadcast ─────────────────
        const locationData = {
          latitude,
          longitude,
          timestamp: new Date().toISOString(),
        };

        // TTL of 5 minutes — if driver disconnects, location survives briefly
        await redis.set(ambulanceKey, JSON.stringify(locationData), 'EX', 300);

        // Broadcast to everyone in the session room (patient + any other listeners)
        io.to(`session:${socket.currentSessionId}`).emit('driver_location', {
          driverId: socket.user.userId,
          latitude,
          longitude,
          timestamp: locationData.timestamp,
        });

        logger.debug(
          `Driver ${socket.user.userId} location broadcast → session:${socket.currentSessionId}`
        );
      } catch (err) {
        logger.error('location_update error', err);
        socket.emit('error', { message: 'Failed to process location update' });
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id} | user: ${socket.user.userId}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

module.exports = { initSocket, getIO };