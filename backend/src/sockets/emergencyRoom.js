const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let io;

/**
 * Initializes Socket.io server and attaches it to the HTTP server.
 * Sets up JWT auth middleware and emergency room event handlers.
 *
 * @param {http.Server} httpServer - Node.js HTTP server instance
 * @returns {Server} Configured Socket.io instance
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,  // 60s before considering connection dead
    pingInterval: 25000, // ping every 25s to keep connection alive
  });

  // ── JWT Auth Middleware ─────────────────────────────────────────────────
  // Runs before every connection — rejects unauthenticated sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { userId: decoded.userId, role: decoded.role };
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection Handler ──────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} | user: ${socket.user.userId}`);

    // Patient joins their emergency session room
    socket.on('join_session', (sessionId) => {
      socket.join(`session:${sessionId}`);
      logger.info(`Socket ${socket.id} joined room session:${sessionId}`);
      socket.emit('joined', { sessionId, message: 'Joined emergency session room' });
    });

    // Driver joins the same session room
    socket.on('join_as_driver', (sessionId) => {
      socket.join(`session:${sessionId}`);
      logger.info(`Driver ${socket.user.userId} joined room session:${sessionId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} | reason: ${reason}`);
    });
  });

  return io;
}

/**
 * Returns the active Socket.io instance.
 * Call initSocket() before using this.
 *
 * @returns {Server} Socket.io instance
 */
function getIO() {
  if (!io) throw new Error('Socket.io not initialized — call initSocket() first');
  return io;
}

module.exports = { initSocket, getIO };