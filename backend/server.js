require('dotenv').config();
const app = require('./app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const { syncAmbulancesToRedis } = require('./src/services/ambulanceCache');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const count = await syncAmbulancesToRedis();
  logger.info(`Synced ${count} ambulances to Redis`);

  app.listen(PORT, () => {
    logger.info(`RapidAid server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });
};

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

startServer();