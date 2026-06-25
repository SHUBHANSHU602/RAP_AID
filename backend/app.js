const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const redis = require('./src/config/redis');
const requestLogger = require('./src/middleware/requestLogger');
const logger = require('./src/utils/logger');
const ambulanceRoutes = require('./src/routes/ambulanceRoutes');
const hospitalRoutes = require('./src/routes/hospitalRoutes');
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
const emergencyRoutes = require('./src/routes/emergencyRoutes');

// With your other route mounts
app.use('/api/v1/emergency', emergencyRoutes);
app.use('/api/v1/ambulances', ambulanceRoutes);
app.use('/api/v1/hospitals', hospitalRoutes);
// Request logger
app.use(requestLogger);
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/v1/auth', authRoutes);
// Health check
app.get('/api/v1/health', async (req, res) => {
  try {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    await redis.ping();
    const redisStatus = 'connected';

    logger.info('Health check hit');
    res.status(200).json({
      success: true,
      message: 'RapidAid server is running',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      services: {
        mongodb: mongoStatus,
        redis: redisStatus
      }
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: 'One or more services are down',
      services: {
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        redis: 'disconnected'
      }
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.message, {
    stack: err.stack,
    requestId: req.requestId,
    statusCode: err.statusCode
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(err.errors).map(e => e.message).join(', ')
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.isOperational ? err.message : 'Internal server error'
  });
});

module.exports = app;