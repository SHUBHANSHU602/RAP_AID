const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) {
      logger.error('Redis max retries reached, giving up');
      return null;
    }
    const delay = Math.min(times * 200, 2000);
    logger.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
    return delay;
  }
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error(`Redis error: ${err.message}`));

module.exports = redis;