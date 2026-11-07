// idGenerator.js – generates human-readable booking and ticket reference IDs
const Counter = require('../models/Counter');

/**
 * Booking ID = "BK" + travel date (YYYYMMDD) + 3-digit running number for that date.
 * The first booking for 15 Oct 2026 is BK20261015001, the next BK20261015002, ...
 * $inc is atomic, so two bookings made at the same moment never get the same number.
 * If the counter is behind the data already in the database (e.g. after seeding
 * sample bookings), numbers that are already taken are skipped.
 */
async function generateBookingId(travelDate) {
  const Booking = require('../models/Booking'); // loaded here to keep the models independent
  const dateKey = String(travelDate).replace(/-/g, ''); // "2026-10-15" -> "20261015"

  for (let attempt = 0; attempt < 1000; attempt++) {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'booking-' + dateKey },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true } // creates the counter on first use
    );
    const id = 'BK' + dateKey + String(counter.seq).padStart(3, '0');
    if (!(await Booking.exists({ Booking_ID: id }))) return id;
  }
  throw new Error('Could not generate a unique Booking ID');
}

module.exports = { generateBookingId };
