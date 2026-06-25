const express = require('express');
const router = express.Router();
const Ambulance = require('../models/Ambulance');
const Hospital = require('../models/Hospital');
const AppError = require('../utils/AppError');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAllAmbulances,
  getAmbulanceById,
  updateAmbulanceStatus,
} = require('../controllers/ambulanceController');
router.use(protect);


router.get('/', getAllAmbulances);
router.get('/:id', getAmbulanceById);
router.patch('/:id/status', restrictTo('ADMIN'), updateAmbulanceStatus);

router.get('/', restrictTo('ADMIN'), async (req, res, next) => {
  try {
    const ambulances = await Ambulance.find().populate('driverId', 'name email');
    res.status(200).json({ success: true, count: ambulances.length, data: ambulances });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', restrictTo('ADMIN'), async (req, res, next) => {
  try {
    const ambulance = await Ambulance.findById(req.params.id).populate('driverId', 'name email');
    if (!ambulance) return next(new AppError('Ambulance not found', 404));
    res.status(200).json({ success: true, data: ambulance });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', restrictTo('ADMIN'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'BUSY'];
    if (!validStatuses.includes(status)) {
      return next(new AppError('Invalid status value', 400));
    }
    const ambulance = await Ambulance.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!ambulance) return next(new AppError('Ambulance not found', 404));
    res.status(200).json({ success: true, data: ambulance });
  } catch (err) {
    next(err);
  }
});

module.exports = router;