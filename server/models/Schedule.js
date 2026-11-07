// Schedule.js – Mongoose schema and model for the schedules collection
//
// One Schedule is one running of one Bus on one date. The bus document keeps
// its own Travel_Date / times / Fare (the assignment's shape), and the
// schedule service writes any change through to the bus so the two never
// disagree.
'use strict';

const mongoose = require('mongoose');

const SCHED_ID_RE = /^S\d{3,5}$/;              // S001
const BUS_ID_RE = /^[A-Z]{2}\d{3,6}$/;         // MB1001
const ROUTE_ID_RE = /^R\d{3,5}$/;              // R001
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const STATUSES = ['Scheduled', 'Departed', 'Cancelled'];

const scheduleSchema = new mongoose.Schema(
  {
    Schedule_ID: {
      type: String,
      required: [true, 'Schedule_ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [SCHED_ID_RE, 'Schedule_ID must look like S001']
    },

    // Business keys stay on the document so queries and responses never need
    // a populate just to read "which bus".
    Bus_ID: {
      type: String,
      required: [true, 'Bus_ID is required'],
      trim: true,
      uppercase: true,
      match: [BUS_ID_RE, 'Bus_ID must look like MB1001']
    },
    Route_ID: {
      type: String,
      trim: true,
      uppercase: true,
      match: [ROUTE_ID_RE, 'Route_ID must look like R001']
    },

    // ObjectId references for populate()
    Bus_Ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus' },
    Route_Ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },

    Travel_Date: {
      type: String,
      required: [true, 'Travel_Date is required'],
      match: [DATE_RE, 'Travel_Date must be YYYY-MM-DD']
    },
    Departure_Time: {
      type: String,
      required: [true, 'Departure_Time is required'],
      match: [TIME_RE, 'Departure_Time must be HH:mm']
    },
    Arrival_Time: {
      type: String,
      required: [true, 'Arrival_Time is required'],
      match: [TIME_RE, 'Arrival_Time must be HH:mm']
    },

    Fare: { type: Number, min: [0, 'Fare must be 0 or more'] },
    Available_Seats: { type: Number, min: [0, 'Available_Seats cannot be negative'], max: 52 },

    Status: {
      type: String,
      enum: { values: STATUSES, message: 'Status must be Scheduled, Departed or Cancelled' },
      default: 'Scheduled'
    }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        delete ret._id;
        return ret;
      }
    }
  }
);

// Overnight services are legitimate (21:00 -> 05:30), so a later arrival is
// only rejected when it is on the same calendar day. The flag records it.
scheduleSchema.pre('validate', function markOvernight() {
  if (this.Departure_Time && this.Arrival_Time && this.Arrival_Time <= this.Departure_Time) {
    this.Next_Day = true;
  }
});

scheduleSchema.add({ Next_Day: { type: Boolean, default: false } });

// One bus cannot run twice at the same moment on the same day.
scheduleSchema.index({ Bus_ID: 1, Travel_Date: 1, Departure_Time: 1 }, { unique: true });
scheduleSchema.index({ Travel_Date: 1 });
scheduleSchema.index({ Route_ID: 1, Travel_Date: 1 });
scheduleSchema.index({ Status: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);
module.exports.STATUSES = STATUSES;
module.exports.SCHED_ID_RE = SCHED_ID_RE;
