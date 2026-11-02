// destinationController.js – handles destination browse / detail / bus lookups
const Destination = require('../models/Destination');
const Bus = require('../models/Bus');

// Matches the shape the brief asks for: { success, count, data }
function ok(res, data, extra) {
  const body = { success: true };
  if (Array.isArray(data)) { body.count = data.length; }
  body.data = data;
  if (extra) { Object.assign(body, extra); }
  return res.status(200).json(body);
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// User input goes into a regex, so neutralise the metacharacters first.
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * GET /api/destinations?category=&search=&popular=true&sort=rating|name
 */
async function list(req, res) {
  try {
    const q = req.query || {};
    const filter = {};

    if (q.category && q.category !== 'All') {
      if (Destination.CATEGORIES.indexOf(q.category) === -1) {
        return fail(res, 400, 'Unknown category: ' + q.category);
      }
      filter.Category = q.category;
    }

    if (q.popular === 'true') { filter.Popular = true; }

    // Substring match rather than $text, so "ell" finds "Ella" as you type.
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ Name: re }, { Tagline: re }, { Province: re }, { Category: re }];
    }

    const sort = q.sort === 'name' ? { Name: 1 } : { Rating: -1, Name: 1 };

    const docs = await Destination.find(filter).sort(sort).lean();
    docs.forEach((d) => { delete d._id; });

    return ok(res, docs);
  } catch (err) {
    console.error('destinations list failed:', err.message);
    return fail(res, 500, 'Could not load destinations');
  }
}

/**
 * GET /api/destinations/:slug
 */
async function getBySlug(req, res) {
  try {
    const doc = await Destination.findOne({ Slug: String(req.params.slug).toLowerCase() }).lean();
    if (!doc) { return fail(res, 404, 'No destination with that slug'); }
    delete doc._id;
    return ok(res, doc);
  } catch (err) {
    console.error('destination lookup failed:', err.message);
    return fail(res, 500, 'Could not load that destination');
  }
}

/**
 * GET /api/destinations/:slug/buses
 * Upcoming services heading to this place, plus the summary the cards show.
 * Reads the existing buses collection directly - Bus.js is not modified.
 */
async function busesTo(req, res) {
  try {
    const slug = String(req.params.slug).toLowerCase();
    const dest = await Destination.findOne({ Slug: slug }).lean();
    if (!dest) { return fail(res, 404, 'No destination with that slug'); }

    // Destination names are free text on Bus, so match case-insensitively on
    // the whole field rather than assuming exact casing.
    const nameRe = new RegExp('^' + escapeRegex(dest.Name) + '$', 'i');

    const buses = await Bus.find({
      Destination: nameRe,
      Travel_Date: { $gte: todayStr() },
      Available_Seats: { $gt: 0 }
    })
      .sort({ Travel_Date: 1, Departure_Time: 1 })
      .limit(20)
      .lean();

    buses.forEach((b) => { delete b._id; });

    // Summary for the card footer / modal header.
    let cheapestFare = null;
    let earliest = null;
    let seatsLeft = 0;

    buses.forEach((b) => {
      const fare = Number(b.Fare) || 0;
      if (cheapestFare === null || fare < cheapestFare) { cheapestFare = fare; }
      seatsLeft += Number(b.Available_Seats) || 0;
      const stamp = b.Travel_Date + ' ' + b.Departure_Time;
      if (earliest === null || stamp < earliest.stamp) {
        earliest = { stamp: stamp, Travel_Date: b.Travel_Date, Departure_Time: b.Departure_Time };
      }
    });

    return ok(res, buses, {
      destination: { Name: dest.Name, Slug: dest.Slug },
      summary: {
        services: buses.length,
        cheapestFare: cheapestFare,
        seatsLeft: seatsLeft,
        earliestDeparture: earliest
          ? { date: earliest.Travel_Date, time: earliest.Departure_Time }
          : null
      }
    });
  } catch (err) {
    console.error('destination buses failed:', err.message);
    return fail(res, 500, 'Could not load buses for that destination');
  }
}

module.exports = { list, getBySlug, busesTo };
