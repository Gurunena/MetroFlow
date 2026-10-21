// Bus.js – Mongoose schema and model for metro buses
const mongoose = require('mongoose');

const BUS_TYPES = ['Normal', 'Semi-Luxury', 'Luxury', 'AC'];
const BUS_STATUSES = ['Available', 'Unavailable'];
const MAX_SEATS = 52; // seat map A1–M4 (13 rows x 4 seats)

const ID_RE = /^[A-Z0-9_-]{3,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "2026-02-30" matches the regex but is not a real calendar date
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isInt = (v) => Number.isInteger(v);

const busSchema = new mongoose.Schema(
  {
    Bus_ID: {
      type: String,
      required: [true, 'Bus_ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [ID_RE, 'Bus_ID must be 3-20 characters: letters, digits, - or _ (e.g. MB1001)']
    },
    Bus_Name: {
      type: String,
      required: [true, 'Bus_Name is required'],
      trim: true,
      minlength: [2, 'Bus_Name must be at least 2 characters'],
      maxlength: [60, 'Bus_Name must be at most 60 characters']
    },
    Bus_Type: {
      type: String,
      enum: { values: BUS_TYPES, message: 'Bus_Type must be one of: ' + BUS_TYPES.join(', ') },
      default: 'Normal'
    },
    Route: { type: String, required: [true, 'Route is required'], trim: true, maxlength: 100 },
    Departure: { type: String, required: [true, 'Departure is required'], trim: true, maxlength: 60 },
    Destination: { type: String, required: [true, 'Destination is required'], trim: true, maxlength: 60 },
    Travel_Date: {
      type: String,
      required: [true, 'Travel_Date is required'],
      validate: { validator: isRealDate, message: 'Travel_Date must be a valid date (YYYY-MM-DD)' }
    },
    Departure_Time: {
      type: String,
      required: [true, 'Departure_Time is required'],
      match: [TIME_RE, 'Departure_Time must be HH:mm (24-hour)']
    },
    Arrival_Time: {
      type: String,
      required: [true, 'Arrival_Time is required'],
      match: [TIME_RE, 'Arrival_Time must be HH:mm (24-hour)']
    },
    Total_Seats: {
      type: Number,
      required: [true, 'Total_Seats (capacity) is required'],
      min: [1, 'Total_Seats must be at least 1'],
      max: [MAX_SEATS, 'Total_Seats cannot be more than ' + MAX_SEATS],
      validate: { validator: isInt, message: 'Total_Seats must be a whole number' }
    },
    Available_Seats: {
      type: Number,
      required: [true, 'Available_Seats is required'],
      min: [0, 'Available_Seats cannot be negative'],
      validate: { validator: isInt, message: 'Available_Seats must be a whole number' }
    },
    Fare: {
      type: Number,
      required: [true, 'Fare is required'],
      min: [0, 'Fare cannot be negative'],
      max: [1000000, 'Fare is too large']
    },
    Status: {
      type: String,
      enum: { values: BUS_STATUSES, message: 'Status must be one of: ' + BUS_STATUSES.join(', ') },
      default: 'Available'
    }
  },
  {
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id; // API records follow the brief's format (no Mongo _id)
        return ret;
      }
    }
  }
);

// Rules that involve more than one field
busSchema.pre('validate', function () {
  if (this.Departure && this.Destination &&
      this.Departure.toLowerCase() === this.Destination.toLowerCase()) {
    this.invalidate('Destination', 'Destination must be different from Departure');
  }
  if (TIME_RE.test(this.Departure_Time) && TIME_RE.test(this.Arrival_Time) &&
      this.Arrival_Time <= this.Departure_Time) {
    this.invalidate('Arrival_Time', 'Arrival_Time must be after Departure_Time');
  }
  if (isInt(this.Total_Seats) && isInt(this.Available_Seats) &&
      this.Available_Seats > this.Total_Seats) {
    this.invalidate('Available_Seats', 'Available_Seats cannot be more than Total_Seats');
  }
});

// Indexes for the search services
busSchema.index({ Travel_Date: 1, Departure_Time: 1 });
busSchema.index({ Departure: 1, Destination: 1, Travel_Date: 1 });

const Bus = mongoose.model('Bus', busSchema);

module.exports = Bus;
module.exports.BUS_TYPES = BUS_TYPES;
module.exports.BUS_STATUSES = BUS_STATUSES;
module.exports.MAX_SEATS = MAX_SEATS;
