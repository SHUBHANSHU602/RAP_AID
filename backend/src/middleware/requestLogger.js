const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
  req.requestId = uuidv4();
  logger.info(`Incoming request`, {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    ip: req.ip
  });
  next();
};

module.exports = requestLogger;