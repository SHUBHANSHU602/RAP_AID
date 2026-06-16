const mongoose = require('mongoose');

const eventLogSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['INITIATED', 'ASSIGNED', 'EN_ROUTE', 'DELAYED', 'RESOLVED'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { _id: false }
);

const emergencySessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required']
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    emergencyType: {
      type: String,
      enum: ['ACCIDENT', 'CARDIAC', 'FIRE', 'STROKE', 'OTHER'],
      required: [true, 'Emergency type is required']
    },
    severityLevel: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    ambulanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ambulance',
      default: null
    },
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null
    },
    status: {
      type: String,
      enum: ['INITIATED', 'ASSIGNED', 'EN_ROUTE', 'DELAYED', 'RESOLVED'],
      default: 'INITIATED'
    },
    eventLog: {
      type: [eventLogSchema],
      default: []
    },
    resolvedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

emergencySessionSchema.index({ userId: 1, status: 1 });
emergencySessionSchema.index({ status: 1, createdAt: -1 });
emergencySessionSchema.index({ ambulanceId: 1 });

emergencySessionSchema.methods.addEvent = function (status, meta = {}) {
  this.eventLog.push({ status, timestamp: new Date(), meta });
  this.status = status;
  if (status === 'RESOLVED') {
    this.resolvedAt = new Date();
  }
};

module.exports = mongoose.model('EmergencySession', emergencySessionSchema);