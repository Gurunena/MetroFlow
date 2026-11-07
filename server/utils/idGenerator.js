// idGenerator.js – generates human-readable booking and ticket reference IDs
const Counter = require('../models/Counter');

/**
 * Booking ID = "BK" + travel date (YYYYMMDD) + 3-digit running number for that date.
 * The first booking for 15 Oct 2026 is BK20261015001, the next BK20261015002, ...
 * $inc is atomic, so two bookings made at the same moment never get the same number.
 */
async function generateBookingId(travelDate) {
  const dateKey = String(travelDate).replace(/-/g, ''); // "2026-10-15" -> "20261015"
  const counter = await Counter.findOneAndUpdate(
    { _id: 'booking-' + dateKey },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true } // creates the counter on first use
  );
  return 'BK' + dateKey + String(counter.seq).padStart(3, '0');
}

/**
 * Neutralises regex metacharacters so user input can be used inside a
 * RegExp safely. busService imports this for its case-insensitive matches.
 */
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { generateBookingId, escapeRegex };
