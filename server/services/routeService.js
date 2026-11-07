// routeService.js – business logic for the routes collection
'use strict';

const Route = require('../models/Route');
const Bus = require('../models/Bus');
const Schedule = require('../models/Schedule');
const { ApiError } = require('../utils/response');
const { escapeRegex } = require('../middleware/validate');

// Case-insensitive exact match, with the input neutralised first.
const ci = (value) => new RegExp('^' + escapeRegex(String(value).trim()) + '$', 'i');

async function getOr404(routeId) {
  const route = await Route.findOne({ Route_ID: String(routeId).toUpperCase() }).lean();
  if (!route) { throw new ApiError(404, 'No route with ID ' + routeId); }
  delete route._id;
  return route;
}

async function list(query) {
  const q = query || {};
  const filter = {};

  if (q.status && q.status !== 'All') { filter.Status = q.status; }
  if (q.from) { filter.Departure = ci(q.from); }
  if (q.to) { filter.Destination = ci(q.to); }

  if (q.search) {
    const re = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    filter.$or = [{ Route_Name: re }, { Departure: re }, { Destination: re }, { Route_ID: re }];
  }

  const docs = await Route.find(filter).sort({ Route_ID: 1 }).lean();
  docs.forEach((d) => { delete d._id; });
  return docs;
}

async function create(data) {
  const id = String(data.Route_ID).toUpperCase();

  if (await Route.exists({ Route_ID: id })) {
    throw new ApiError(409, 'Route ' + id + ' already exists');
  }
  const samePair = await Route.findOne({
    Departure: ci(data.Departure), Destination: ci(data.Destination)
  }).lean();
  if (samePair) {
    throw new ApiError(409,
      'A route from ' + data.Departure + ' to ' + data.Destination +
      ' already exists (' + samePair.Route_ID + ')');
  }

  const doc = await Route.create(Object.assign({}, data, { Route_ID: id }));
  const out = doc.toObject();
  delete out._id;
  return out;
}

async function update(routeId, data) {
  const id = String(routeId).toUpperCase();
  const route = await Route.findOne({ Route_ID: id });
  if (!route) { throw new ApiError(404, 'No route with ID ' + routeId); }

  // Route_ID is the public key; changing it would orphan every reference.
  const changes = Object.assign({}, data);
  delete changes.Route_ID;
  delete changes._id;

  Object.assign(route, changes);
  await route.save();

  const out = route.toObject();
  delete out._id;
  return out;
}

/**
 * Deleting a corridor that buses or schedules still point at would leave
 * dangling references, so it is blocked with 409 rather than cascaded.
 */
async function remove(routeId) {
  const id = String(routeId).toUpperCase();
  const route = await Route.findOne({ Route_ID: id });
  if (!route) { throw new ApiError(404, 'No route with ID ' + routeId); }

  const buses = await Bus.countDocuments({ Route_ID: id });
  const scheds = await Schedule.countDocuments({ Route_ID: id });

  if (buses > 0 || scheds > 0) {
    const parts = [];
    if (buses) { parts.push(buses + ' bus(es)'); }
    if (scheds) { parts.push(scheds + ' schedule(s)'); }
    throw new ApiError(409,
      'Route ' + id + ' is in use by ' + parts.join(' and ') +
      '. Reassign or delete them first.');
  }

  await route.deleteOne();
  const out = route.toObject();
  delete out._id;
  return out;
}

/**
 * Used by the bus service and the migration: find the corridor for a
 * departure/destination pair, creating it if it does not exist yet.
 */
async function findOrCreateFor(departure, destination, hints) {
  const from = String(departure || '').trim();
  const to = String(destination || '').trim();
  if (!from || !to) { return null; }

  const existing = await Route.findOne({ Departure: ci(from), Destination: ci(to) }).lean();
  if (existing) { delete existing._id; return existing; }

  // Next free R### number.
  const last = await Route.find({}, { Route_ID: 1, _id: 0 }).sort({ Route_ID: -1 }).limit(1).lean();
  const nextNum = last.length ? Number(String(last[0].Route_ID).slice(1)) + 1 : 1;
  const extras = hints || {};

  const doc = await Route.create({
    Route_ID: 'R' + String(nextNum).padStart(3, '0'),
    Route_Name: from + ' - ' + to,
    Departure: from,
    Destination: to,
    Distance_KM: extras.Distance_KM || 100,
    Duration_Min: extras.Duration_Min || 150,
    Base_Fare: extras.Base_Fare || 1000,
    Stops: extras.Stops || [],
    Status: 'Active'
  });

  const out = doc.toObject();
  delete out._id;
  return out;
}

module.exports = { getOr404, list, create, update, remove, findOrCreateFor };
