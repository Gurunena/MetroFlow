// Counter.js – running number per travel date, used to build Booking IDs
const mongoose = require('mongoose');

// e.g. { _id: "booking-20261015", seq: 3 }  ->  the next ID is BK20261015004
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
  },
  { versionKey: false }
);

module.exports = mongoose.model('Counter', counterSchema);
