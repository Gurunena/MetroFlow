// busSearchController.js – read-only bus lookups for the search page
// ---------------------------------------------------------------------------
// This exists because server/routes/busRoutes.js cannot currently mount: it was
// refactored to new handler names (list, available, byDate, …) while
// busController.js still exports the old ones (getAllBuses, getAvailable, …)
// and calls service functions that were themselves renamed. Rather than
// rewrite a teammate's in-flight controller, this file provides just the
// read endpoints search.html needs, and routes/index.js only mounts it when
// their router fails. Fix busController and this stops being used.
// ---------------------------------------------------------------------------
const Bus = require('../models/Bus');
const { todayStr, isValidYMD } = require('../utils/dates');
const { escapeRegex } = require('../utils/idGenerator');

// Same envelope as the rest of the API: { success, count?, data }
function ok(res, data) {
  const body = { success: true };
  if (Array.isArray(data)) { body.count = data.length; }
  body.data = data;
  return res.status(200).json(body);
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

const SORT = { Travel_Date: 1, Departure_Time: 1 };

// Case-insensitive partial match on a free-text place name.
function ci(value) {
  return new RegExp(escapeRegex(String(value).trim()), 'i');
}

function clean(doc) {
  delete doc._id;
  return doc;
}

/**
 * GET /api/buses/available?from=&to=&date=&minSeats=
 * Buses with at least `minSeats` free. Without a date, upcoming trips only.
 */
async function available(req, res) {
  try {
    const q = req.query || {};
    const minSeats = Math.max(1, parseInt(q.minSeats, 10) || 1);
    const filter = { Available_Seats: { $gte: minSeats } };

    if (q.from) { filter.Departure = ci(q.from); }
    if (q.to) { filter.Destination = ci(q.to); }

    if (q.date) {
      if (!isValidYMD(q.date)) {
        return fail(res, 400, 'Date must be a valid YYYY-MM-DD');
      }
      filter.Travel_Date = q.date;
    } else {
      filter.Travel_Date = { $gte: todayStr() };
    }

    const buses = await Bus.find(filter).sort(SORT).lean();
    return ok(res, buses.map(clean));
  } catch (err) {
    console.error('bus search (available) failed:', err.message);
    return fail(res, 500, 'Could not search buses');
  }
}

/** GET /api/buses/departure/:departure */
async function byDeparture(req, res) {
  try {
    const buses = await Bus.find({ Departure: ci(req.params.departure) }).sort(SORT).lean();
    return ok(res, buses.map(clean));
  } catch (err) {
    console.error('bus search (departure) failed:', err.message);
    return fail(res, 500, 'Could not look up that departure point');
  }
}

/** GET /api/buses/destination/:destination */
async function byDestination(req, res) {
  try {
    const buses = await Bus.find({ Destination: ci(req.params.destination) }).sort(SORT).lean();
    return ok(res, buses.map(clean));
  } catch (err) {
    console.error('bus search (destination) failed:', err.message);
    return fail(res, 500, 'Could not look up that destination');
  }
}

/** GET /api/buses/date/:date */
async function byDate(req, res) {
  try {
    if (!isValidYMD(req.params.date)) {
      return fail(res, 400, 'Date must be a valid YYYY-MM-DD');
    }
    const buses = await Bus.find({ Travel_Date: req.params.date }).sort(SORT).lean();
    return ok(res, buses.map(clean));
  } catch (err) {
    console.error('bus search (date) failed:', err.message);
    return fail(res, 500, 'Could not look up that date');
  }
}

/** GET /api/buses/locations – distinct places, for the search datalist. */
async function locations(req, res) {
  try {
    const [departures, destinations] = await Promise.all([
      Bus.distinct('Departure'),
      Bus.distinct('Destination')
    ]);
    const all = departures.concat(destinations)
      .filter(Boolean)
      .sort(function (a, b) { return a.localeCompare(b); });
    // de-duplicate while keeping the sorted order
    const unique = all.filter(function (v, i) { return all.indexOf(v) === i; });
    return ok(res, unique);
  } catch (err) {
    console.error('bus search (locations) failed:', err.message);
    return fail(res, 500, 'Could not load locations');
  }
}

/** GET /api/buses – all upcoming buses (the no-filter landing state). */
async function list(req, res) {
  try {
    const buses = await Bus.find({ Travel_Date: { $gte: todayStr() } }).sort(SORT).lean();
    return ok(res, buses.map(clean));
  } catch (err) {
    console.error('bus search (list) failed:', err.message);
    return fail(res, 500, 'Could not load buses');
  }
}

/** GET /api/buses/:busId */
async function getById(req, res) {
  try {
    const bus = await Bus.findOne({ Bus_ID: String(req.params.busId).toUpperCase() }).lean();
    if (!bus) { return fail(res, 404, 'No bus with ID ' + req.params.busId); }
    return ok(res, clean(bus));
  } catch (err) {
    console.error('bus search (getById) failed:', err.message);
    return fail(res, 500, 'Could not load that bus');
  }
}

module.exports = { available, byDeparture, byDestination, byDate, locations, list, getById };
