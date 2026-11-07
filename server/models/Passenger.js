// Passenger.js – Mongoose schema and model for passengers (Member 3)
const mongoose = require('mongoose');

const GENDERS = ['Male', 'Female', 'Other', ''];

const NIC_RE = /^([0-9]{9}[VvXx]|[0-9]{12}|[A-Za-z][0-9]{7,8})$/; // old NIC, new NIC or passport
const PHONE_RE = /^(\+94\d{9}|0\d{9})$/;                         // +94771234567 or 0771234567
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const passengerSchema = new mongoose.Schema(
  {
    Passenger_ID: { type: String, required: true, unique: true, trim: true, uppercase: true },
    Full_Name: {
      type: String,
      required: [true, 'Full_Name is required'],
      trim: true,
      minlength: [2, 'Full_Name must be at least 2 characters'],
      maxlength: [60, 'Full_Name must be at most 60 characters']
    },
    NIC: {
      type: String,
      required: [true, 'NIC / Passport is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [NIC_RE, 'NIC must be 9 digits + V/X, 12 digits, or a passport number like N1234567']
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
    Address: { type: String, trim: true, maxlength: 150, default: '' },
    Gender: {
      type: String,
      enum: { values: GENDERS, message: 'Gender must be Male, Female or Other' },
      default: ''
    }
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id; // API records follow the brief's style (no Mongo _id)
        return ret;
      }
    }
  }
);

// Indexes for the search box
passengerSchema.index({ Full_Name: 1 });
passengerSchema.index({ Phone: 1 });
passengerSchema.index({ Email: 1 });

const Passenger = mongoose.model('Passenger', passengerSchema);

module.exports = Passenger;
module.exports.NIC_RE = NIC_RE;
module.exports.PHONE_RE = PHONE_RE;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.GENDERS = GENDERS;
