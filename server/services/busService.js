// busService.js – business logic for searching and managing buses
const mongoose = require('mongoose');
const Bus = require('../models/Bus');

// Error that carries an HTTP status – the controller turns it into a JSON response
class ServiceError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ID_RE = /^[A-Z0-9_-]{3,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Fields an operator may change with PUT. Bus_ID is the key, Available_Seats is system-managed.
const EDITABLE = [
  'Bus_Name', 'Bus_Type', 'Route', 'Departure', 'Destination',
  'Travel_Date', 'Departure_Time', 'Arrival_Time', 'Total_Seats', 'Fare', 'Status'
];
const SCHEDULE_FIELDS = ['Travel_Date', 'Departure_Time', 'Arrival_Time'];

const SORT = { Travel_Date: 1, Departure_Time: 1 };
const HIDE_ID = '-_id';

/* ---------- small helpers ---------- */

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeId(value) {
  const id = String(value == null ? '' : value).trim().toUpperCase();
  if (!ID_RE.test(id)) {
    throw new ServiceError(400, 'Invalid Bus_ID – use 3-20 letters, digits, - or _ (e.g. MB1001)');
  }
  return id;
}

function requireDate(value) {
  const v = String(value == null ? '' : value).trim();
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const real = DATE_RE.test(v) && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  if (!real) throw new ServiceError(400, 'Invalid date – use YYYY-MM-DD');
  return v;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServiceError(400, label + ' is required');
  }
  if (value.length > 100) throw new ServiceError(400, label + ' is too long');
  return value.trim();
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
    out[key] = value;
  });
  return out;
}

// case-insensitive "contains" match, e.g. "colombo" finds "Colombo Fort"
function containsFilter(value) {
  return new RegExp(escapeRegex(value), 'i');
}

/* ---------- create / read ---------- */

async function createBus(body) {
  const data = pick(body, ['Bus_ID'].concat(EDITABLE, ['Available_Seats']));
  // a new bus starts with all seats free unless a different number is supplied
  if (data.Available_Seats === undefined || data.Available_Seats === null || data.Available_Seats === '') {
    data.Available_Seats = data.Total_Seats;
  }
  const bus = await Bus.create(data); // schema validators run here
  return bus.toJSON();
}

function listBuses() {
  return Bus.find().select(HIDE_ID).sort(SORT).lean();
}

async function getBusById(busId) {
  const bus = await Bus.findOne({ Bus_ID: normalizeId(busId) }).select(HIDE_ID).lean();
  if (!bus) throw new ServiceError(404, 'Bus not found');
  return bus;
}

function findByRoute(route) {
  return Bus.find({ Route: containsFilter(requireText(route, 'Route')) }).select(HIDE_ID).sort(SORT).lean();
}

function findByDeparture(departure) {
  return Bus.find({ Departure: containsFilter(requireText(departure, 'Departure')) })
    .select(HIDE_ID).sort(SORT).lean();
}

function findByDestination(destination) {
  return Bus.find({ Destination: containsFilter(requireText(destination, 'Destination')) })
    .select(HIDE_ID).sort(SORT).lean();
}

function findByDate(date) {
  return Bus.find({ Travel_Date: requireDate(date) }).select(HIDE_ID).sort(SORT).lean();
}

// GET /api/buses/available?from=&to=&date=&time=&minSeats=
// (departure= / destination= are accepted as aliases of from= / to=)
function searchAvailable(query) {
  const q = query || {};
  const read = (...names) => {
    for (const name of names) {
      const v = q[name];
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string') throw new ServiceError(400, name + ' must be a single value');
      return v.trim();
    }
    return undefined;
  };

  const from = read('from', 'departure');
  const to = read('to', 'destination');
  const date = read('date');
  const time = read('time');
  const minSeatsRaw = read('minSeats');

  const minSeats = minSeatsRaw === undefined ? 1 : Number(minSeatsRaw);
  if (!Number.isInteger(minSeats) || minSeats < 1) {
    throw new ServiceError(400, 'minSeats must be a whole number of 1 or more');
  }

  const filter = { Status: 'Available', Available_Seats: { $gte: minSeats } };
  if (from) filter.Departure = containsFilter(from);
  if (to) filter.Destination = containsFilter(to);
  if (date) filter.Travel_Date = requireDate(date);
  if (time) {
    if (!TIME_RE.test(time)) throw new ServiceError(400, 'Invalid time – use HH:mm');
    filter.Departure_Time = time;
  }
  return Bus.find(filter).select(HIDE_ID).sort(SORT).lean();
}

// distinct places – used for the autocomplete lists
async function getLocations() {
  const [departures, destinations] = await Promise.all([
    Bus.distinct('Departure'),
    Bus.distinct('Destination')
  ]);
  return Array.from(new Set(departures.concat(destinations))).sort((a, b) => a.localeCompare(b));
}

/* ---------- update ---------- */

// Applies already-picked changes to a bus.
// Available_Seats is system-managed: when the capacity changes, the same difference is applied
// to Available_Seats using an atomic $inc, so a booking made at the same moment is never lost.
async function applyChanges(busId, changes) {
  const id = normalizeId(busId);
  const bus = await Bus.findOne({ Bus_ID: id });
  if (!bus) throw new ServiceError(404, 'Bus not found');

  const oldTotal = bus.Total_Seats;
  const oldAvailable = bus.Available_Seats;
  const booked = oldTotal - oldAvailable;

  bus.set(changes);

  let delta = 0;
  if (changes.Total_Seats !== undefined && Number.isInteger(bus.Total_Seats)) {
    delta = bus.Total_Seats - oldTotal;
    if (bus.Total_Seats < booked) {
      throw new ServiceError(409, 'Total_Seats cannot be less than the ' + booked + ' seats already booked');
    }
    bus.Available_Seats = oldAvailable + delta;
  }

  await bus.validate(); // throws a ValidationError if any rule is broken

  const $set = {};
  Object.keys(changes).forEach((key) => {
    if (key !== 'Total_Seats') $set[key] = bus.get(key); // cast + trimmed value
  });
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (delta !== 0) update.$inc = { Total_Seats: delta, Available_Seats: delta };
  if (!Object.keys(update).length) return getBusById(id); // nothing actually changed

  const filter = { Bus_ID: id };
  if (delta !== 0) {
    filter.Total_Seats = oldTotal;
    if (delta < 0) filter.Available_Seats = { $gte: -delta };
  }

  const updated = await Bus.findOneAndUpdate(filter, update, { new: true }).select(HIDE_ID).lean();
  if (!updated) {
    if (!(await Bus.exists({ Bus_ID: id }))) throw new ServiceError(404, 'Bus not found');
    throw new ServiceError(409, 'Seats changed while updating (a booking was made) – please try again');
  }
  return updated;
}

async function updateBus(busId, body) {
  const changes = pick(body, EDITABLE);
  if (body && body.Bus_ID !== undefined && String(body.Bus_ID).trim().toUpperCase() !== normalizeId(busId)) {
    throw new ServiceError(400, 'Bus_ID cannot be changed');
  }
  if (!Object.keys(changes).length) throw new ServiceError(400, 'No updatable fields were supplied');
  return applyChanges(busId, changes);
}

async function updateSchedule(busId, body) {
  const changes = pick(body, SCHEDULE_FIELDS);
  if (!Object.keys(changes).length) {
    throw new ServiceError(400, 'Supply at least one of: ' + SCHEDULE_FIELDS.join(', '));
  }
  return applyChanges(busId, changes);
}

/* ---------- delete ---------- */

async function deleteBus(busId) {
  const id = normalizeId(busId);
  const bus = await Bus.findOne({ Bus_ID: id }).select(HIDE_ID).lean();
  if (!bus) throw new ServiceError(404, 'Bus not found');

  // The Booking model belongs to another module; use it if it has been loaded.
  const Booking = mongoose.models.Booking;
  if (Booking) {
    const confirmed = await Booking.countDocuments({ Bus_ID: id, Booking_Status: 'Confirmed' });
    if (confirmed > 0) {
      throw new ServiceError(409, 'Bus has ' + confirmed + ' confirmed booking(s) – cancel them before deleting the bus');
    }
  }
  await Bus.deleteOne({ Bus_ID: id });
  return bus;
}

module.exports = {
  ServiceError,
  createBus,
  listBuses,
  getBusById,
  findByRoute,
  findByDeparture,
  findByDestination,
  findByDate,
  searchAvailable,
  getLocations,
  updateBus,
  updateSchedule,
  deleteBus
};
