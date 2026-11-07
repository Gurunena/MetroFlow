// bookingService.js – business logic for creating and cancelling bookings
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const { generateBookingId } = require('../utils/idGenerator');

const { PHONE_RE, EMAIL_RE, SEAT_RE } = Booking;

// Error that carries an HTTP status – the controller turns it into a JSON response
class ServiceError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const BOOKING_ID_RE = /^BK\d{11,}$/;
const BUS_ID_RE = /^[A-Z0-9_-]{3,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fields a passenger may send. Everything else (date, destination, fare, status) comes from the bus.
const CREATE_FIELDS = ['Passenger_Name', 'Phone', 'Email', 'Bus_ID', 'Seat_Number', 'Boarding_Point'];
const UPDATE_FIELDS = ['Passenger_Name', 'Phone', 'Email', 'Seat_Number', 'Boarding_Point'];

const SORT = { Travel_Date: 1, Booking_ID: 1 };
const HIDE_ID = '-_id';

/* ---------- small helpers ---------- */

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Copy only the allowed fields from a request body. Objects/arrays are rejected so that
// values such as {"$gt": ""} can never reach a query or update.
function pick(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceError(400, 'Request body must be a JSON object');
  }
  const out = {};
  fields.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return;
    const value = body[key];
    if (value !== null && typeof value === 'object') {
      throw new ServiceError(400, key + ' must be a simple value, not an object or array');
    }
    out[key] = value === null ? '' : String(value).trim();
  });
  return out;
}

function cleanPhone(phone) {
  return String(phone).replace(/[\s-]/g, '');
}

function normalizeBookingId(value) {
  const id = String(value == null ? '' : value).trim().toUpperCase();
  if (!BOOKING_ID_RE.test(id)) {
    throw new ServiceError(400, 'Invalid Booking_ID – it looks like BK20261015001');
  }
  return id;
}

function requireText(value, label) {
  const v = String(value == null ? '' : value).trim();
  if (!v) throw new ServiceError(400, label + ' is required');
  if (v.length > 100) throw new ServiceError(400, label + ' is too long');
  return v;
}

// Collects every problem with the passenger fields so the form can show them all at once.
// partial = only check the fields that were sent (used by update)
function validatePassenger(data, partial) {
  const details = [];
  const check = (field, ok, message) => {
    if (partial && data[field] === undefined) return;
    if (!ok) details.push({ field, message });
  };
  check('Passenger_Name', data.Passenger_Name && data.Passenger_Name.length >= 2 && data.Passenger_Name.length <= 60,
    'Passenger_Name must be 2-60 characters');
  check('Phone', data.Phone && PHONE_RE.test(cleanPhone(data.Phone)), 'Phone must look like +94771234567 or 0771234567');
  check('Email', data.Email && EMAIL_RE.test(data.Email), 'Email is not valid');
  check('Seat_Number', data.Seat_Number && SEAT_RE.test(data.Seat_Number.toUpperCase()), 'Seat_Number must be between A1 and M4');
  if (details.length) throw new ServiceError(400, details[0].message, details);
}

// A1 -> 1, A4 -> 4, B1 -> 5 ... M4 -> 52 (same 2 + 2 layout as the seat map)
function seatIndex(seat) {
  return (seat.charCodeAt(0) - 65) * 4 + Number(seat.slice(1));
}

// current time as "HH:mm", to compare with Departure_Time
function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function seatIsTaken(busId, travelDate, seat) {
  return Booking.exists({ Bus_ID: busId, Travel_Date: travelDate, Seat_Number: seat, Booking_Status: 'Confirmed' });
}

/* ---------- extension point for future services (designed, not implemented) ----------
   e.g. hooks.afterCreate = async (booking) => sendSms(booking.Phone, ...)
   Payments, SMS/email notifications and digital tickets can plug in here
   without changing the routes, controllers or front end. */
const hooks = {
  afterCreate: async () => {},
  afterCancel: async () => {}
};

/* ---------- 1. Insert a Passenger Booking ----------
   Links passenger + bus + schedule + seat in one step. */
async function createBooking(body) {
  const data = pick(body, CREATE_FIELDS);
  validatePassenger(data, false);

  const busId = requireText(data.Bus_ID, 'Bus_ID').toUpperCase();
  if (!BUS_ID_RE.test(busId)) throw new ServiceError(400, 'Invalid Bus_ID (e.g. MB1001)');
  const seat = data.Seat_Number.toUpperCase();

  // Bus + schedule: must exist, be running and not have left already
  const bus = await Bus.findOne({ Bus_ID: busId }).lean();
  if (!bus) throw new ServiceError(404, 'Bus ' + busId + ' not found');
  // 'Active' and 'Available' both mean the service is running. Only an
  // explicitly withdrawn bus blocks a booking.
  const BOOKABLE = ['Available', 'Active'];
  if (bus.Status && BOOKABLE.indexOf(bus.Status) === -1) {
    throw new ServiceError(409, 'Bus ' + busId + ' is not available for booking');
  }
  if (bus.Travel_Date < today()) throw new ServiceError(409, 'This bus has already departed');
  if (bus.Travel_Date === today() && bus.Departure_Time && bus.Departure_Time <= nowTime()) {
    throw new ServiceError(409, 'This bus has already departed (' + bus.Departure_Time + ' today)');
  }

  // Seat: must exist on this bus and be free on this trip
  if (seatIndex(seat) > bus.Total_Seats) {
    throw new ServiceError(400, 'Seat ' + seat + ' does not exist on this bus (' + bus.Total_Seats + ' seats)');
  }
  if (await seatIsTaken(busId, bus.Travel_Date, seat)) {
    throw new ServiceError(409, 'Seat ' + seat + ' is already booked');
  }

  // Reserve one seat. The condition makes this atomic: it fails if no seats are left.
  const reserved = await Bus.findOneAndUpdate(
    { Bus_ID: busId, Available_Seats: { $gt: 0 } },
    { $inc: { Available_Seats: -1 } }
  );
  if (!reserved) throw new ServiceError(409, 'This bus is fully booked');

  try {
    // Schedule details (date, destination, fare) are copied from the bus – never trusted from the client
        let bookingId = await generateBookingId(bus.Travel_Date);
    while (await Booking.exists({ Booking_ID: bookingId })) {
      bookingId = await generateBookingId(bus.Travel_Date); // skip IDs already used by sample data
    }
    const booking = await Booking.create({
      Booking_ID: bookingId,
      Passenger_Name: data.Passenger_Name,
      Phone: cleanPhone(data.Phone),
      Email: data.Email,
      Bus_ID: busId,
      Travel_Date: bus.Travel_Date,
      Seat_Number: seat,
      Boarding_Point: data.Boarding_Point || bus.Departure,
      Destination: bus.Destination,
      Fare: bus.Fare,
      Booking_Status: 'Confirmed'
    });
    await hooks.afterCreate(booking);
    return booking.toJSON();
  } catch (err) {
    // Booking failed (e.g. two people took the same seat at the same moment) – give the seat back
    await Bus.updateOne(
      { Bus_ID: busId, $expr: { $lt: ['$Available_Seats', '$Total_Seats'] } },
      { $inc: { Available_Seats: 1 } }
    );
    if (err && err.code === 11000) throw new ServiceError(409, 'Seat ' + seat + ' is already booked');
    throw err;
  }
}

/* ---------- 2–8. View & search ---------- */

// 2. Show all Bookings
function listBookings() {
  return Booking.find().select(HIDE_ID).sort(SORT).lean();
}

// 3. Find a Booking by Booking ID
async function getBookingById(bookingId) {
  const booking = await Booking.findOne({ Booking_ID: normalizeBookingId(bookingId) }).select(HIDE_ID).lean();
  if (!booking) throw new ServiceError(404, 'Booking not found');
  return booking;
}

// 4. Find Bookings by Passenger Name – partial and case-insensitive: "kumara" finds "Kumara Silva"
function findByPassengerName(name) {
  const filter = { Passenger_Name: new RegExp(escapeRegex(requireText(name, 'Passenger name')), 'i') };
  return Booking.find(filter).select(HIDE_ID).sort(SORT).lean();
}

// 5. Find Bookings by Phone Number – 0771001001 and +94771001001 find the same bookings
function findByPhone(phone) {
  const p = cleanPhone(requireText(phone, 'Phone'));
  const local = p.startsWith('+94') ? '0' + p.slice(3) : p;
  const intl = p.startsWith('0') ? '+94' + p.slice(1) : p;
  return Booking.find({ Phone: { $in: [local, intl] } }).select(HIDE_ID).sort(SORT).lean();
}

// 6. Find Bookings by Email
function findByEmail(email) {
  return Booking.find({ Email: requireText(email, 'Email').toLowerCase() }).select(HIDE_ID).sort(SORT).lean();
}

// 7. Find Bookings by Bus ID
function findByBusId(busId) {
  return Booking.find({ Bus_ID: requireText(busId, 'Bus_ID').toUpperCase() })
    .select(HIDE_ID).sort({ Seat_Number: 1 }).lean();
}

// 8. Find Bookings by Travel Date
function findByTravelDate(date) {
  const d = requireText(date, 'Date');
  if (!DATE_RE.test(d)) throw new ServiceError(400, 'Invalid date – use YYYY-MM-DD');
  return Booking.find({ Travel_Date: d }).select(HIDE_ID).sort(SORT).lean();
}

// helper for the seat map: seats already taken on a bus
async function getBookedSeats(busId) {
  const id = requireText(busId, 'Bus_ID').toUpperCase();
  const bus = await Bus.findOne({ Bus_ID: id }).lean();
  if (!bus) throw new ServiceError(404, 'Bus ' + id + ' not found');
  return Booking.distinct('Seat_Number', { Bus_ID: id, Travel_Date: bus.Travel_Date, Booking_Status: 'Confirmed' });
}

/* ---------- 9. Update Booking Details ----------
   Passenger details, boarding point and seat can change.
   Bus, date and fare cannot – to change bus, cancel and book again. */
async function updateBooking(bookingId, body) {
  const changes = pick(body, UPDATE_FIELDS);
  if (!Object.keys(changes).length) {
    throw new ServiceError(400, 'Supply at least one of: ' + UPDATE_FIELDS.join(', '));
  }
  validatePassenger(changes, true);

  const booking = await Booking.findOne({ Booking_ID: normalizeBookingId(bookingId) });
  if (!booking) throw new ServiceError(404, 'Booking not found');
  if (booking.Booking_Status === 'Cancelled') throw new ServiceError(409, 'A cancelled booking cannot be updated');

  if (changes.Seat_Number !== undefined) {
    const seat = changes.Seat_Number.toUpperCase();
    if (seat !== booking.Seat_Number) {
      const bus = await Bus.findOne({ Bus_ID: booking.Bus_ID }).lean();
      if (bus && seatIndex(seat) > bus.Total_Seats) {
        throw new ServiceError(400, 'Seat ' + seat + ' does not exist on this bus (' + bus.Total_Seats + ' seats)');
      }
      if (await seatIsTaken(booking.Bus_ID, booking.Travel_Date, seat)) {
        throw new ServiceError(409, 'Seat ' + seat + ' is already booked');
      }
      booking.Seat_Number = seat;
    }
  }
  if (changes.Passenger_Name !== undefined) booking.Passenger_Name = changes.Passenger_Name;
  if (changes.Phone !== undefined) booking.Phone = cleanPhone(changes.Phone);
  if (changes.Email !== undefined) booking.Email = changes.Email;
  if (changes.Boarding_Point) booking.Boarding_Point = changes.Boarding_Point;

  try {
    await booking.save(); // schema validators run here
  } catch (err) {
    if (err && err.code === 11000) throw new ServiceError(409, 'That seat is already booked');
    throw err;
  }
  return booking.toJSON();
}

/* ---------- 10. Cancel a Booking by Booking ID ----------
   The booking is kept (status -> Cancelled) and its seat goes back to the bus. */
async function cancelBooking(bookingId) {
  const id = normalizeBookingId(bookingId);
  const booking = await Booking.findOneAndUpdate(
    { Booking_ID: id, Booking_Status: 'Confirmed' }, // only a Confirmed booking can be cancelled
    { $set: { Booking_Status: 'Cancelled' } },
    { returnDocument: 'after' }
  );

  if (!booking) {
    if (await Booking.exists({ Booking_ID: id })) throw new ServiceError(409, 'Booking ' + id + ' is already cancelled');
    throw new ServiceError(404, 'Booking not found');
  }

  // $expr caps the increment at the coach's capacity, so a seat can never be
  // handed back twice and leave the bus claiming more seats than it has.
  await Bus.updateOne(
    { Bus_ID: booking.Bus_ID, $expr: { $lt: ['$Available_Seats', '$Total_Seats'] } },
    { $inc: { Available_Seats: 1 } }
  );
  await hooks.afterCancel(booking);
  return booking.toJSON();
}

module.exports = {
  ServiceError,
  hooks,
  createBooking,
  listBookings,
  getBookingById,
  findByPassengerName,
  findByPhone,
  findByEmail,
  findByBusId,
  findByTravelDate,
  getBookedSeats,
  updateBooking,
  cancelBooking
};
