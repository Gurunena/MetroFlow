// routeScheduleService.js – business rules for Route & Schedule Management (no Express code here)
// Re-uses busService for the actual saving, so there is still only ONE place that writes buses.
const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const busService = require('./busService');

const { ServiceError } = busService; // same class, so busController-style error handling works

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HIDE_ID = '-_id';
const SORT = { Travel_Date: 1, Departure_Time: 1 };

/* ---------- helpers ---------- */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contains = (s) => new RegExp(escapeRegex(s), 'i');

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// "2026-02-30" matches the regex but is not a real date
function isRealDate(v) {
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ServiceError(400, label + ' is required');
  if (value.trim().length > 100) throw new ServiceError(400, label + ' is too long');
  return value.trim();
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceError(400, 'Request body must be a JSON object');
  }
  return body;
}

/* ---------- timetable search ---------- */

// GET /api/schedules?route=&from=&to=&date=&availableOnly=true
// (departure= / destination= are accepted as aliases of from= / to=)
function searchTimetable(query) {
  const q = query || {};
  const read = (...names) => {
    for (const name of names) {
      const v = q[name];
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string') throw new ServiceError(400, name + ' must be a single value'); // blocks ?route[$ne]=x
      return v.trim();
    }
    return undefined;
  };

  const route = read('route');
  const from = read('from', 'departure');
  const to = read('to', 'destination');
  const date = read('date');
  const availableOnly = read('availableOnly') === 'true';

  const filter = {};
  if (route) filter.Route = contains(route);
  if (from) filter.Departure = contains(from);
  if (to) filter.Destination = contains(to);
  if (date) {
    if (!isRealDate(date)) throw new ServiceError(400, 'date must be a real date in YYYY-MM-DD format');
    filter.Travel_Date = date;
  }
  if (availableOnly) {
    filter.Status = 'Available';
    filter.Available_Seats = { $gt: 0 };
    if (!date) filter.Travel_Date = { $gte: today() }; // upcoming trips only
  }
  return Bus.find(filter).select(HIDE_ID).sort(SORT).lean();
}

// GET /api/schedules/routes – one row per route: trips, fare range, seats left, next departure
function routeSummary() {
  return Bus.aggregate([
    { $match: { Status: 'Available', Travel_Date: { $gte: today() } } },
    {
      $group: {
        _id: '$Route',
        Departure: { $first: '$Departure' },
        Destination: { $first: '$Destination' },
        trips: { $sum: 1 },
        minFare: { $min: '$Fare' },
        maxFare: { $max: '$Fare' },
        seatsLeft: { $sum: '$Available_Seats' },
        nextDeparture: { $min: { $concat: ['$Travel_Date', ' ', '$Departure_Time'] } }
      }
    },
    { $project: { _id: 0, Route: '$_id', Departure: 1, Destination: 1, trips: 1, minFare: 1, maxFare: 1, seatsLeft: 1, nextDeparture: 1 } },
    { $sort: { Route: 1 } }
  ]);
}

/* ---------- route management ---------- */

// PATCH /api/schedules/:busId/route   body: { Route, Departure, Destination }
async function updateRoute(busId, body) {
  const b = requireObject(body);
  const changes = {
    Route: requireText(b.Route, 'Route'),
    Departure: requireText(b.Departure, 'Departure'),
    Destination: requireText(b.Destination, 'Destination')
  };
  if (changes.Departure.toLowerCase() === changes.Destination.toLowerCase()) {
    throw new ServiceError(400, 'Departure and Destination must be different');
  }

  const bus = await busService.getBusById(busId); // 400 for a bad ID, 404 if missing

  // Bookings keep a copy of the destination, so moving the stops under paying passengers is blocked.
  // (Renaming only the Route label is always fine.)
  const stopsChanged =
    bus.Departure.toLowerCase() !== changes.Departure.toLowerCase() ||
    bus.Destination.toLowerCase() !== changes.Destination.toLowerCase();
  if (stopsChanged) {
    const confirmed = await Booking.countDocuments({ Bus_ID: bus.Bus_ID, Booking_Status: 'Confirmed' });
    if (confirmed > 0) {
      throw new ServiceError(409, 'Bus has ' + confirmed + ' confirmed booking(s) – cancel them before changing its departure or destination');
    }
  }
  return busService.updateBus(bus.Bus_ID, changes);
}

/* ---------- schedule management ---------- */

// PATCH /api/schedules/:busId/schedule   body: { Travel_Date, Departure_Time, Arrival_Time }
// All three are required. Existing bookings are moved to the new date together with the bus.
async function updateSchedule(busId, body) {
  const b = requireObject(body);
  const Travel_Date = typeof b.Travel_Date === 'string' ? b.Travel_Date.trim() : '';
  const Departure_Time = typeof b.Departure_Time === 'string' ? b.Departure_Time.trim() : '';
  const Arrival_Time = typeof b.Arrival_Time === 'string' ? b.Arrival_Time.trim() : '';

  if (!isRealDate(Travel_Date)) throw new ServiceError(400, 'Travel_Date must be a real date in YYYY-MM-DD format');
  if (Travel_Date < today()) throw new ServiceError(400, 'Travel_Date cannot be in the past');
  if (!TIME_RE.test(Departure_Time)) throw new ServiceError(400, 'Departure_Time must be HH:mm (24-hour)');
  if (!TIME_RE.test(Arrival_Time)) throw new ServiceError(400, 'Arrival_Time must be HH:mm (24-hour)');
  if (Arrival_Time <= Departure_Time) throw new ServiceError(400, 'Arrival_Time must be later than Departure_Time');

  const before = await busService.getBusById(busId);
  const updated = await busService.updateSchedule(before.Bus_ID, { Travel_Date, Departure_Time, Arrival_Time });

  // Bookings store their own copy of Travel_Date (the seat map and the no-double-booking index use it),
  // so they must follow the bus. MongoDB has no transaction here, so undo the bus change if this fails.
  if (before.Travel_Date !== Travel_Date) {
    try {
      await Booking.updateMany({ Bus_ID: before.Bus_ID, Travel_Date: before.Travel_Date }, { $set: { Travel_Date } });
    } catch (err) {
      await Bus.updateOne(
        { Bus_ID: before.Bus_ID },
        { $set: { Travel_Date: before.Travel_Date, Departure_Time: before.Departure_Time, Arrival_Time: before.Arrival_Time } }
      );
      throw new ServiceError(409, 'Could not move the existing bookings to the new date – schedule was not changed');
    }
  }
  return updated;
}

module.exports = { searchTimetable, routeSummary, updateRoute, updateSchedule };
