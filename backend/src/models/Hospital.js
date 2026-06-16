const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    specializations: {
      type: [String],
      enum: [
        'CARDIAC',
        'TRAUMA',
        'NEUROLOGY',
        'BURNS',
        'PEDIATRIC',
        'GENERAL'
      ],
      required: true
    },
    availableBeds: {
      type: Number,
      required: true,
      min: 0
    },
    emergencyCapacity: {
      type: Number,
      required: true,
      min: 0
    },
    avgHandlingTime: {
      type: Number,
      required: true,
      min: 0
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

hospitalSchema.index({ 'location.lat': 1, 'location.lng': 1 });
hospitalSchema.index({ specializations: 1 });
hospitalSchema.index({ availableBeds: 1 });

module.exports = mongoose.model('Hospital', hospitalSchema);