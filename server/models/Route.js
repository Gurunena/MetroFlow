// Route.js – Mongoose schema and model for the routes collection
//
// A Route is the fixed corridor ("Colombo - Kandy"); a Bus is one service on
// that corridor on one date. Buses keep their own Route/Departure/Destination
// strings so the assignment's JSON shape is unchanged — Route_ID is an
// additive reference on top of that, never a replacement.
'use strict';

const mongoose = require('mongoose');

const ROUTE_ID_RE = /^R\d{3,5}$/;          // R001
const STATUSES = ['Active', 'Inactive'];

const routeSchema = new mongoose.Schema(
  {
    Route_ID: {
      type: String,
      required: [true, 'Route_ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [ROUTE_ID_RE, 'Route_ID must look like R001']
    },
    Route_Name: {
      type: String,
      required: [true, 'Route_Name is required'],
      trim: true,
      minlength: [3, 'Route_Name must be at least 3 characters'],
      maxlength: [80, 'Route_Name must be at most 80 characters']
    },
    Departure: { type: String, required: [true, 'Departure is required'], trim: true, maxlength: 60 },
    Destination: { type: String, required: [true, 'Destination is required'], trim: true, maxlength: 60 },

    Distance_KM: {
      type: Number,
      required: [true, 'Distance_KM is required'],
      min: [1, 'Distance_KM must be at least 1'],
      max: [2000, 'Distance_KM must be at most 2000']
    },
    Duration_Min: {
      type: Number,
      required: [true, 'Duration_Min is required'],
      min: [1, 'Duration_Min must be at least 1'],
      max: [2880, 'Duration_Min must be at most 2880']
    },
    Base_Fare: {
      type: Number,
      required: [true, 'Base_Fare is required'],
      min: [0, 'Base_Fare must be 0 or more']
    },

    Stops: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 25,
        message: 'Stops can hold at most 25 entries'
      }
    },

    Status: {
      type: String,
      enum: { values: STATUSES, message: 'Status must be Active or Inactive' },
      default: 'Active'
    }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        delete ret._id;          // the public identifier is Route_ID
        return ret;
      }
    }
  }
);

// A corridor is unique by its two endpoints, so the seed/migration can
// upsert on them without creating duplicates.
routeSchema.index({ Departure: 1, Destination: 1 }, { unique: true });
routeSchema.index({ Status: 1 });

module.exports = mongoose.model('Route', routeSchema);
module.exports.STATUSES = STATUSES;
module.exports.ROUTE_ID_RE = ROUTE_ID_RE;
