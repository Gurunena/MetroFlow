// Booking.js – Mongoose schema and model for seat bookings
const mongoose = require('mongoose');

const BOOKING_STATUSES = ['Confirmed', 'Cancelled'];

const PHONE_RE = /^(\+94\d{9}|0\d{9})$/;             // +94771234567 or 0771234567
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEAT_RE = /^[A-M][1-4]$/;                       // seat map A1–M4 (13 rows x 4 seats)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Field names follow the "Passenger Booking Record" format in the assignment brief
const bookingSchema = new mongoose.Schema(
  {
    Booking_ID: { type: String, required: true, unique: true, trim: true, uppercase: true },
    Passenger_Name: {
      type: String,
      required: [true, 'Passenger_Name is required'],
      trim: true,
      minlength: [2, 'Passenger_Name must be at least 2 characters'],
      maxlength: [60, 'Passenger_Name must be at most 60 characters']
    },
    Phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      match: [PHONE_RE, 'Phone must look like +94771234567 or 0771234567']
    },
    Email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: [EMAIL_RE, 'Email is not valid']
    },
    Bus_ID: { type: String, required: [true, 'Bus_ID is required'], trim: true, uppercase: true },
    Travel_Date: { type: String, required: true, match: [DATE_RE, 'Travel_Date must be YYYY-MM-DD'] },
    Seat_Number: {
      type: String,
      required: [true, 'Seat_Number is required'],
      trim: true,
      uppercase: true,
      match: [SEAT_RE, 'Seat_Number must be between A1 and M4']
    },
    Boarding_Point: { type: String, required: true, trim: true, maxlength: 60 },
    Destination: { type: String, required: true, trim: true, maxlength: 60 },
    Fare: { type: Number, required: true, min: 0 },
    Booking_Status: {
      type: String,
      enum: { values: BOOKING_STATUSES, message: 'Booking_Status must be Confirmed or Cancelled' },
      default: 'Confirmed'
    }
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id; // API records follow the brief's format (no Mongo _id)
        return ret;
      }
    }
  }
);

// No double booking: only ONE Confirmed booking per seat on a trip.
// Cancelled bookings are left out of the index, so a cancelled seat can be booked again.
bookingSchema.index(
  { Bus_ID: 1, Travel_Date: 1, Seat_Number: 1 },
  { unique: true, partialFilterExpression: { Booking_Status: 'Confirmed' } }
);

// Indexes for the search services
bookingSchema.index({ Passenger_Name: 1 });
bookingSchema.index({ Phone: 1 });
bookingSchema.index({ Email: 1 });
bookingSchema.index({ Travel_Date: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
module.exports.PHONE_RE = PHONE_RE;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.SEAT_RE = SEAT_RE;
