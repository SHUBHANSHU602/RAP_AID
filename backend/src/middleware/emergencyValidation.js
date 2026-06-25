const { body } = require('express-validator');

exports.validateTrigger = [
  body('lat')
    .notEmpty().withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),

  body('lng')
    .notEmpty().withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),

  body('emergencyType')
    .notEmpty().withMessage('Emergency type is required')
    .isIn(['ACCIDENT', 'CARDIAC', 'FIRE', 'STROKE', 'OTHER'])
    .withMessage('Invalid emergency type'),

  body('severityLevel')
    .notEmpty().withMessage('Severity level is required')
    .isInt({ min: 1, max: 5 }).withMessage('Severity must be between 1 and 5'),
];