const mongoose = require('mongoose');

const ambulanceSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Driver ID is required'],
      unique: true
    },
    currentLocation: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'BUSY'],
      default: 'AVAILABLE'
    },
    lastPing: {
      type: Date,
      default: Date.now
    },
    assignedSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmergencySession',
      default: null
    },
    serviceArea: {
      type: {
        type: String,
        enum: ['Polygon'],
        required: true
      },
      coordinates: {
        type: [[[Number]]],
        required: true
      }
    }
  },
  {
    timestamps: true
  }
);

ambulanceSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });
ambulanceSchema.index({ status: 1 });
ambulanceSchema.index({ serviceArea: '2dsphere' });

module.exports = mongoose.model('Ambulance', ambulanceSchema);