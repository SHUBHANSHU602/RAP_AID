const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const AppError = require('../utils/AppError');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/', async (req, res, next) => {
  try {
    const hospitals = await Hospital.find({ isActive: true });
    res.status(200).json({ success: true, count: hospitals.length, data: hospitals });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital || !hospital.isActive) {
      return next(new AppError('Hospital not found', 404));
    }
    res.status(200).json({ success: true, data: hospital });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/beds', restrictTo('ADMIN'), async (req, res, next) => {
  try {
    const { availableBeds } = req.body;
    if (typeof availableBeds !== 'number' || availableBeds < 0) {
      return next(new AppError('Invalid bed count', 400));
    }
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { availableBeds },
      { new: true, runValidators: true }
    );
    if (!hospital) return next(new AppError('Hospital not found', 404));
    res.status(200).json({ success: true, data: hospital });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', restrictTo('ADMIN'), async (req, res, next) => {
  try {
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!hospital) return next(new AppError('Hospital not found', 404));
    res.status(200).json({ success: true, message: 'Hospital deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;