// scheduleService.js – business logic for the schedules collection
//
// Creating or updating a schedule writes the date/times/fare through to the
// linked bus, because the front end reads those from the bus document and
// the two must never disagree.
'use strict';

const Schedule = require('../models/Schedule');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Booking = require('../models/Booking');
const { ApiError } = require('../utils/response');

async function getOr404(scheduleId) {
  const doc = await Schedule.findOne({ Schedule_ID: String(scheduleId).toUpperCase() }).lean();
  if (!doc) { throw new ApiError(404, 'No schedule with ID ' + scheduleId); }
  delete doc._id;
  return doc;
}

async function list(query) {
  const q = query || {};
  const filter = {};

  if (q.busId) { filter.Bus_ID = String(q.busId).toUpperCase(); }
  if (q.routeId) { filter.Route_ID = String(q.routeId).toUpperCase(); }
  if (q.date) { filter.Travel_Date = String(q.date); }
  if (q.status && q.status !== 'All') { filter.Status = q.status; }

  const docs = await Schedule.find(filter)
    .sort({ Travel_Date: 1, Departure_Time: 1 })
    .lean();

  docs.forEach((d) => { delete d._id; });
  return docs;
}

// Push a schedule's timing onto its bus, and move existing bookings with it.
async function syncBus(busDoc, fields) {
  const prevDate = busDoc.Travel_Date;
  let touched = false;

  ['Travel_Date', 'Departure_Time', 'Arrival_Time', 'Fare'].forEach((key) => {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') {
      busDoc[key] = fields[key];
      touched = true;
    }
  });

  if (!touched) { return; }

  await busDoc.save();

  if (busDoc.Travel_Date !== prevDate) {
    await Booking.updateMany({ Bus_ID: busDoc.Bus_ID }, { Travel_Date: busDoc.Travel_Date });
  }
}

async function create(data) {
  const scheduleId = String(data.Schedule_ID).toUpperCase();
  const busId = String(data.Bus_ID).toUpperCase();

  if (await Schedule.exists({ Schedule_ID: scheduleId })) {
    throw new ApiError(409, 'Schedule ' + scheduleId + ' already exists');
  }

  const bus = await Bus.findOne({ Bus_ID: busId });
  if (!bus) { throw new ApiError(404, 'No bus with ID ' + busId); }

  // Route comes from the bus unless the caller named one explicitly.
  let routeId = data.Route_ID ? String(data.Route_ID).toUpperCase() : bus.Route_ID;
  let routeRef = null;
  if (routeId) {
    const route = await Route.findOne({ Route_ID: routeId }).lean();
    if (!route) { throw new ApiError(404, 'No route with ID ' + routeId); }
    routeRef = route._id;
  }

  const clash = await Schedule.findOne({
    Bus_ID: busId, Travel_Date: data.Travel_Date, Departure_Time: data.Departure_Time
  }).lean();
  if (clash) {
    throw new ApiError(409,
      'Bus ' + busId + ' already has a schedule at ' + data.Departure_Time +
      ' on ' + data.Travel_Date + ' (' + clash.Schedule_ID + ')');
  }

  const doc = await Schedule.create({
    Schedule_ID: scheduleId,
    Bus_ID: busId,
    Route_ID: routeId,
    Bus_Ref: bus._id,
    Route_Ref: routeRef,
    Travel_Date: data.Travel_Date,
    Departure_Time: data.Departure_Time,
    Arrival_Time: data.Arrival_Time,
    Fare: data.Fare !== undefined ? data.Fare : bus.Fare,
    Available_Seats: data.Available_Seats !== undefined ? data.Available_Seats : bus.Available_Seats,
    Status: data.Status || 'Scheduled'
  });

  await syncBus(bus, {
    Travel_Date: data.Travel_Date,
    Departure_Time: data.Departure_Time,
    Arrival_Time: data.Arrival_Time,
    Fare: data.Fare
  });

  const out = doc.toObject();
  delete out._id;
  return out;
}

async function update(scheduleId, data) {
  const id = String(scheduleId).toUpperCase();
  const schedule = await Schedule.findOne({ Schedule_ID: id });
  if (!schedule) { throw new ApiError(404, 'No schedule with ID ' + scheduleId); }

  const changes = Object.assign({}, data);
  delete changes.Schedule_ID;
  delete changes._id;

  if (changes.Bus_ID) {
    const nextBus = await Bus.findOne({ Bus_ID: String(changes.Bus_ID).toUpperCase() });
    if (!nextBus) { throw new ApiError(404, 'No bus with ID ' + changes.Bus_ID); }
    changes.Bus_ID = nextBus.Bus_ID;
    changes.Bus_Ref = nextBus._id;
  }

  if (changes.Route_ID) {
    const route = await Route.findOne({ Route_ID: String(changes.Route_ID).toUpperCase() }).lean();
    if (!route) { throw new ApiError(404, 'No route with ID ' + changes.Route_ID); }
    changes.Route_ID = route.Route_ID;
    changes.Route_Ref = route._id;
  }

  Object.assign(schedule, changes);
  await schedule.save();

  const bus = await Bus.findOne({ Bus_ID: schedule.Bus_ID });
  if (bus) {
    await syncBus(bus, {
      Travel_Date: changes.Travel_Date,
      Departure_Time: changes.Departure_Time,
      Arrival_Time: changes.Arrival_Time,
      Fare: changes.Fare
    });
  }

  const out = schedule.toObject();
  delete out._id;
  return out;
}

async function remove(scheduleId) {
  const id = String(scheduleId).toUpperCase();
  const schedule = await Schedule.findOne({ Schedule_ID: id });
  if (!schedule) { throw new ApiError(404, 'No schedule with ID ' + scheduleId); }

  const held = await Booking.countDocuments({
    Schedule_ID: id, Booking_Status: 'Confirmed'
  });
  if (held > 0) {
    throw new ApiError(409,
      'Schedule ' + id + ' has ' + held + ' confirmed booking(s). Cancel them first.');
  }

  await schedule.deleteOne();
  const out = schedule.toObject();
  delete out._id;
  return out;
}

module.exports = { getOr404, list, create, update, remove };
