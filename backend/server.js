require('dotenv').config();
const app = require('./app');
const connectDB = require('./src/config/db');
const redis = require('./src/config/redis');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`RapidAid server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
};

startServer();