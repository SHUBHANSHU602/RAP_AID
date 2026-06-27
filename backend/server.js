require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const { syncAmbulancesToRedis } = require('./src/services/ambulanceCache');
const { initSocket } = require('./src/sockets/emergencyRoom');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const count = await syncAmbulancesToRedis();
  logger.info(`Synced ${count} ambulances to Redis`);

  // Create HTTP server from Express app
  const httpServer = http.createServer(app);

  // Attach Socket.io to HTTP server
  initSocket(httpServer);

  // Listen on HTTP server, not Express app directly
  httpServer.listen(PORT, () => {
    logger.info(`RapidAid server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    logger.info(`Socket.io ready`);
  });
};

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

startServer();