const EmergencySession = require('../models/EmergencySession');
const AppError = require('../utils/AppError');
const { validationResult } = require('express-validator');

exports.triggerEmergency = async (req, res, next) => {
  try {
    const { lat, lng, emergencyType, severityLevel } = req.body;

    const session = await EmergencySession.create({
     userId: req.user.userId,
      location: { lat, lng },
      emergencyType,
      severityLevel,
    });

    res.status(201).json({
      success: true,
      message: 'Emergency session created',
      data: {
        sessionId: session._id,
        status: session.status,
        emergencyType: session.emergencyType,
        severityLevel: session.severityLevel,
        location: session.location,
        createdAt: session.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getSession = async (req, res, next) => {
  try {
    const session = await EmergencySession.findById(req.params.id)
      .populate('ambulanceId', 'currentLocation status')
      .populate('hospitalId', 'name address');

    if (!session) {
      return next(new AppError('Session not found', 404));
    }

    // Only the session owner or admin can view it
    if (
      session.userId.toString() !== req.user.userId.toString() &&
      req.user.role !== 'ADMIN'
    ) {
      return next(new AppError('Not authorized to view this session', 403));
    }

    res.status(200).json({
      success: true,
      data: session,
    });
  } catch (err) {
    next(err);
  }
};