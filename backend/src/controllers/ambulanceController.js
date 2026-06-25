const Ambulance = require('../models/Ambulance');
const AppError = require('../utils/AppError');
const { updateAmbulanceStatus, getAmbulanceStatus } = require('../services/ambulanceCache');

exports.getAllAmbulances = async (req, res, next) => {
  try {
    const ambulances = await Ambulance.find({}).populate('driverId', 'name email');
    res.status(200).json({ success: true, count: ambulances.length, data: ambulances });
  } catch (err) {
    next(err);
  }
};

exports.getAmbulanceById = async (req, res, next) => {
  try {
    const ambulance = await Ambulance.findById(req.params.id).populate('driverId', 'name email');
    if (!ambulance) return next(new AppError('Ambulance not found', 404));

    // Enrich with live Redis status
    const liveStatus = await getAmbulanceStatus(req.params.id);

    res.status(200).json({
      success: true,
      data: {
        ...ambulance.toObject(),
        liveStatus: liveStatus || ambulance.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateAmbulanceStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['AVAILABLE', 'BUSY', 'OFFLINE'];

    if (!validStatuses.includes(status)) {
      return next(new AppError(`Status must be one of: ${validStatuses.join(', ')}`, 400));
    }

    const ambulance = await Ambulance.findById(req.params.id);
    if (!ambulance) return next(new AppError('Ambulance not found', 404));

    await updateAmbulanceStatus(req.params.id, status);

    res.status(200).json({
      success: true,
      message: `Ambulance status updated to ${status}`,
      data: { ambulanceId: req.params.id, status },
    });
  } catch (err) {
    next(err);
  }
};