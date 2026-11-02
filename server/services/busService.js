/**
 * Bus service — all business logic for Metro Bus resources.
 * Controllers stay thin and call into here; this keeps logic reusable (chat bot, admin, future jobs).
 */
const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const { ApiError } = require('../utils/response');
const { escapeRegex } = require('../utils/idGenerator');
const { todayStr, isValidYMD } = require('../utils/dates');

const ci = (s) => new RegExp(escapeRegex(s.trim()), 'i'); // case-insensitive partial match
const SORT = { Travel_Date: 1, Departure_Time: 1 };

/** Seat labels for a bus with N seats in a 2+2 layout: A1..A4, B1..B4, ... */
function seatLabels(totalSeats) {
  const rows = 'ABCDEFGHIJKLM';
  const out = [];
  for (let i = 0; i < totalSeats; i++) out.push(rows[Math.floor(i / 4)] + ((i % 4) + 1));
  return out;
}

async function getBusOr404(busId) {
  const bus = await Bus.findOne({ Bus_ID: String(busId).toUpperCase() });
  if (!bus) throw new ApiError(404, `Bus ${busId} not found`);
  return bus;
}

const confirmedCount = (busId) => Booking.countDocuments({ Bus_ID: busId, Booking_Status: 'Confirmed' });

/* ---------- Queries ---------- */

/** GET /api/buses — optional ?from=&to=&date=&upcoming=true filters (used by the search page). */
function list({ from, to, date, upcoming } = {}) {
  const q = {};
  if (from) q.Departure = ci(from);
  if (to) q.Destination = ci(to);
  if (date) q.Travel_Date = date;
  else if (upcoming === 'true') q.Travel_Date = { $gte: todayStr() };
  return Bus.find(q).sort(SORT).lean();
}

const findByRoute = (route) => Bus.find({ Route: ci(route) }).sort(SORT).lean();
const findByDeparture = (dep) => Bus.find({ Departure: ci(dep) }).sort(SORT).lean();
const findByDestination = (dest) => Bus.find({ Destination: ci(dest) }).sort(SORT).lean();

function findByDate(date) {
  if (!isValidYMD(date)) throw new ApiError(400, 'Date must be a valid YYYY-MM-DD');
  return Bus.find({ Travel_Date: date }).sort(SORT).lean();
}

/** Buses with free seats. Defaults to upcoming trips only. */
function findAvailable({ from, to, date, minSeats } = {}) {
  const seats = Math.max(1, parseInt(minSeats, 10) || 1);
  const q = { Available_Seats: { $gte: seats } };
  if (from) q.Departure = ci(from);
  if (to) q.Destination = ci(to);
  if (date) {
    if (!isValidYMD(date)) throw new ApiError(400, 'Date must be a valid YYYY-MM-DD');
    q.Travel_Date = date;
  } else {
    q.Travel_Date = { $gte: todayStr() };
  }
  return Bus.find(q).sort(SORT).lean();
}

/** Booked seat labels for a bus on a date. */
async function getSeatMap(busId, date) {
  const bus = await getBusOr404(busId);
  const travelDate = date || bus.Travel_Date;
  const booked = await Booking.find(
    { Bus_ID: bus.Bus_ID, Travel_Date: travelDate, Booking_Status: 'Confirmed' },
    { Seat_Number: 1, _id: 0 }
  ).lean();
  return {
    Bus_ID: bus.Bus_ID,
    Travel_Date: travelDate,
    total: bus.Total_Seats,
    seats: seatLabels(bus.Total_Seats),
    booked: booked.map((b) => b.Seat_Number).sort(),
    available: bus.Available_Seats,
    fare: bus.Fare,
  };
}

/** Top routes by number of confirmed bookings, with cheapest upcoming fare + next departure. */
async function popularRoutes(limit = 6) {
  const today = todayStr();
  const routes = await Bus.aggregate([
    { $match: { Travel_Date: { $gte: today } } },
    { $sort: { Travel_Date: 1, Departure_Time: 1 } },
    {
      $lookup: {
        from: 'bookings',
        let: { id: '$Bus_ID' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$Bus_ID', '$$id'] }, { $eq: ['$Booking_Status', 'Confirmed'] }] } } }, { $count: 'n' }],
        as: 'b',
      },
    },
    {
      $group: {
        _id: { from: '$Departure', to: '$Destination' },
        Route: { $first: '$Route' },
        bookings: { $sum: { $ifNull: [{ $arrayElemAt: ['$b.n', 0] }, 0] } },
        minFare: { $min: '$Fare' },
        seats: { $sum: '$Available_Seats' },
        trips: { $sum: 1 },
        next: { $first: { Bus_ID: '$Bus_ID', Travel_Date: '$Travel_Date', Departure_Time: '$Departure_Time', Arrival_Time: '$Arrival_Time', Available_Seats: '$Available_Seats', Fare: '$Fare', Bus_Name: '$Bus_Name' } },
      },
    },
    { $sort: { bookings: -1, trips: -1 } },
    { $limit: Math.min(Number(limit) || 6, 20) },
    { $project: { _id: 0, Departure: '$_id.from', Destination: '$_id.to', Route: 1, bookings: 1, minFare: 1, seats: 1, trips: 1, next: 1 } },
  ]);
  return routes;
}

/** Distinct place names (for autocomplete). */
async function locations() {
  const [deps, dests] = await Promise.all([Bus.distinct('Departure'), Bus.distinct('Destination')]);
  return [...new Set([...deps, ...dests])].sort();
}

/* ---------- Commands ---------- */

async function create(data) {
  const exists = await Bus.exists({ Bus_ID: String(data.Bus_ID).toUpperCase() });
  if (exists) throw new ApiError(409, `Bus ${data.Bus_ID} already exists`);
  const doc = { ...data };
  if (doc.Available_Seats === undefined || doc.Available_Seats === '') doc.Available_Seats = doc.Total_Seats ?? 50;
  return (await Bus.create(doc)).toObject();
}

/**
 * Full update of bus details. Bus_ID is immutable.
 * Available_Seats is system-managed once bookings exist: it is recalculated as Total_Seats − confirmed bookings.
 */
async function update(busId, data) {
  const bus = await getBusOr404(busId);
  const { Bus_ID, _id, createdAt, updatedAt, ...changes } = data; // eslint-disable-line no-unused-vars
  const booked = await confirmedCount(bus.Bus_ID);
  const prevDate = bus.Travel_Date;

  Object.assign(bus, changes);
  if (bus.Total_Seats < booked) throw new ApiError(409, `Total_Seats cannot be below ${booked} (seats already booked)`);
  if (booked > 0 || changes.Available_Seats === undefined) bus.Available_Seats = bus.Total_Seats - booked;

  await bus.save();
  if (bus.Travel_Date !== prevDate) await Booking.updateMany({ Bus_ID: bus.Bus_ID }, { Travel_Date: bus.Travel_Date });
  return bus.toObject();
}

/** Update only the schedule (date / times). Existing bookings follow the new date. */
async function updateSchedule(busId, { Travel_Date, Departure_Time, Arrival_Time }) {
  const bus = await getBusOr404(busId);
  const prevDate = bus.Travel_Date;
  if (Travel_Date !== undefined) bus.Travel_Date = Travel_Date;
  if (Departure_Time !== undefined) bus.Departure_Time = Departure_Time;
  if (Arrival_Time !== undefined) bus.Arrival_Time = Arrival_Time;
  await bus.save();
  if (bus.Travel_Date !== prevDate) await Booking.updateMany({ Bus_ID: bus.Bus_ID }, { Travel_Date: bus.Travel_Date });
  return bus.toObject();
}

/**
 * Delete a bus. Policy: BLOCK (409) while the bus has Confirmed bookings —
 * an operator must cancel them first. Cancelled booking history is kept.
 */
async function remove(busId) {
  const bus = await getBusOr404(busId);
  const active = await confirmedCount(bus.Bus_ID);
  if (active > 0) throw new ApiError(409, `Bus ${bus.Bus_ID} has ${active} confirmed booking(s). Cancel them before deleting.`);
  await bus.deleteOne();
  return bus.toObject();
}

module.exports = {
  seatLabels, getBusOr404, list, findByRoute, findByDeparture, findByDestination, findByDate,
  findAvailable, getSeatMap, popularRoutes, locations, create, update, updateSchedule, remove,
};
