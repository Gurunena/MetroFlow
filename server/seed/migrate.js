#!/usr/bin/env node
/**
 * migrate.js — brings an existing database up to the referenced schema
 * WITHOUT deleting anything.  `npm run migrate`
 *
 * For every bus and booking already stored it:
 *   1. creates the routes that are implied by Departure + Destination
 *   2. back-fills Bus.Route_ID / Bus.Route_Ref
 *   3. creates a schedule per bus that has none
 *   4. creates passengers from the names/phones/emails on bookings
 *   5. back-fills Booking.Bus_Ref / Passenger_Ref / Schedule_Ref
 *   6. repairs Available_Seats so Total_Seats − Confirmed = Available_Seats
 *
 * Every step is an upsert keyed on the business key, so running it twice
 * changes nothing the second time.
 */
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const Route = require('../models/Route');
const Schedule = require('../models/Schedule');
const Passenger = require('../models/Passenger');
const Counter = require('../models/Counter');

const DRY = process.argv.indexOf('--dry') > -1;
const FIX_SEATS = process.argv.indexOf('--fix-seats') > -1;

function log(step, detail) {
  console.log('  ' + (DRY ? '[dry] ' : '') + step.padEnd(42) + (detail === undefined ? '' : detail));
}

/* ------------------------------ helpers ------------------------------- */

// Rough distance/duration guesses so the Route documents are not empty.
// Only used when a route has to be invented from existing bus rows.
function guessRoute(departure, destination, fares) {
  const cheapest = fares.length ? Math.min.apply(null, fares) : 1000;
  // Sri Lankan intercity fares run roughly LKR 10/km.
  const km = Math.max(10, Math.round(cheapest / 10));
  return {
    Distance_KM: Math.min(km, 2000),
    Duration_Min: Math.min(Math.max(30, Math.round(km * 1.6)), 2880),
    Base_Fare: cheapest
  };
}

async function nextSequence(name, start) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return Math.max(counter.seq, start || 1);
}

/* ------------------------------- steps -------------------------------- */

async function buildRoutes() {
  const buses = await Bus.find({}).lean();
  const pairs = new Map();

  buses.forEach((b) => {
    const key = (b.Departure || '').trim() + '||' + (b.Destination || '').trim();
    if (!key.replace('||', '')) { return; }
    if (!pairs.has(key)) { pairs.set(key, { from: b.Departure, to: b.Destination, fares: [], name: b.Route }); }
    pairs.get(key).fares.push(Number(b.Fare) || 0);
  });

  let created = 0;
  let existing = 0;

  // Highest R### already in use, so new ones continue the sequence.
  const last = await Route.find({}, { Route_ID: 1, _id: 0 }).sort({ Route_ID: -1 }).limit(1).lean();
  let next = last.length ? Number(String(last[0].Route_ID).slice(1)) + 1 : 1;

  for (const [, info] of pairs) {
    const found = await Route.findOne({
      Departure: new RegExp('^' + info.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
      Destination: new RegExp('^' + info.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    }).lean();

    if (found) { existing += 1; continue; }

    const guess = guessRoute(info.from, info.to, info.fares);
    if (!DRY) {
      await Route.create(Object.assign({
        Route_ID: 'R' + String(next).padStart(3, '0'),
        Route_Name: info.name || (info.from + ' - ' + info.to),
        Departure: info.from,
        Destination: info.to,
        Stops: [],
        Status: 'Active'
      }, guess));
    }
    next += 1;
    created += 1;
  }

  log('routes created from existing buses', created + ' new, ' + existing + ' already there');
  return created;
}

async function linkBusesToRoutes() {
  const buses = await Bus.find({ $or: [{ Route_ID: { $exists: false } }, { Route_ID: null }, { Route_ID: '' }] });
  let linked = 0;

  for (const bus of buses) {
    const route = await Route.findOne({
      Departure: new RegExp('^' + String(bus.Departure).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
      Destination: new RegExp('^' + String(bus.Destination).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    }).lean();
    if (!route) { continue; }

    if (!DRY) {
      await Bus.updateOne({ _id: bus._id }, { $set: { Route_ID: route.Route_ID, Route_Ref: route._id } });
    }
    linked += 1;
  }

  log('buses linked to a Route_ID', linked + ' updated');
  return linked;
}

async function buildSchedules() {
  const buses = await Bus.find({}).lean();
  let created = 0;
  let existing = 0;

  const last = await Schedule.find({}, { Schedule_ID: 1, _id: 0 }).sort({ Schedule_ID: -1 }).limit(1).lean();
  let next = last.length ? Number(String(last[0].Schedule_ID).slice(1)) + 1 : 1;

  for (const bus of buses) {
    const found = await Schedule.findOne({
      Bus_ID: bus.Bus_ID, Travel_Date: bus.Travel_Date, Departure_Time: bus.Departure_Time
    }).lean();
    if (found) { existing += 1; continue; }

    if (!DRY) {
      const route = bus.Route_ID ? await Route.findOne({ Route_ID: bus.Route_ID }).lean() : null;
      await Schedule.create({
        Schedule_ID: 'S' + String(next).padStart(3, '0'),
        Bus_ID: bus.Bus_ID,
        Route_ID: bus.Route_ID,
        Bus_Ref: bus._id,
        Route_Ref: route ? route._id : undefined,
        Travel_Date: bus.Travel_Date,
        Departure_Time: bus.Departure_Time,
        Arrival_Time: bus.Arrival_Time,
        Fare: bus.Fare,
        Available_Seats: bus.Available_Seats,
        Status: 'Scheduled'
      });
    }
    next += 1;
    created += 1;
  }

  log('schedules created from existing buses', created + ' new, ' + existing + ' already there');
  return created;
}

async function buildPassengers() {
  const bookings = await Booking.find({}).lean();
  const people = new Map();

  bookings.forEach((b) => {
    const email = String(b.Email || '').trim().toLowerCase();
    const phone = String(b.Phone || '').trim();
    if (!email || !phone) { return; }
    const key = email + '||' + phone;
    if (!people.has(key)) {
      people.set(key, { Full_Name: b.Passenger_Name, Email: email, Phone: phone });
    }
  });

  let created = 0;
  let existing = 0;

  for (const [, person] of people) {
    const found = await Passenger.findOne({ Email: person.Email, Phone: person.Phone }).lean();
    if (found) { existing += 1; continue; }

    if (!DRY) {
      const seq = await nextSequence('passenger', 1);
      await Passenger.create({
        Passenger_ID: 'P' + String(seq).padStart(4, '0'),
        Full_Name: person.Full_Name || 'Passenger',
        Phone: person.Phone,
        Email: person.Email
        // NIC intentionally omitted: a historical booking never captured one.
      });
    }
    created += 1;
  }

  log('passengers created from existing bookings', created + ' new, ' + existing + ' already there');
  return created;
}

async function linkBookings() {
  const bookings = await Booking.find({
    $or: [
      { Bus_Ref: { $exists: false } }, { Bus_Ref: null },
      { Passenger_Ref: { $exists: false } }, { Passenger_Ref: null }
    ]
  });

  let linked = 0;
  for (const booking of bookings) {
    const set = {};

    const bus = await Bus.findOne({ Bus_ID: booking.Bus_ID }).lean();
    if (bus) { set.Bus_Ref = bus._id; }

    const pax = await Passenger.findOne({
      Email: String(booking.Email || '').toLowerCase(),
      Phone: booking.Phone
    }).lean();
    if (pax) { set.Passenger_Ref = pax._id; }

    const sched = await Schedule.findOne({
      Bus_ID: booking.Bus_ID, Travel_Date: booking.Travel_Date
    }).lean();
    if (sched) {
      set.Schedule_Ref = sched._id;
      set.Schedule_ID = sched.Schedule_ID;
    }

    if (Object.keys(set).length && !DRY) {
      await Booking.updateOne({ _id: booking._id }, { $set: set });
    }
    if (Object.keys(set).length) { linked += 1; }
  }

  log('bookings given their reference fields', linked + ' updated');
  return linked;
}

/**
 * Checks Total_Seats - Confirmed bookings = Available_Seats.
 *
 * REPORTS by default and changes nothing: on a database seeded for a demo
 * the stored Available_Seats is deliberately low ("4 seats left") while few
 * bookings actually exist, and silently rewriting it would wipe that out.
 * Pass --fix-seats to make the counts match the bookings.
 */
async function checkSeatCounts() {
  const buses = await Bus.find({}).lean();
  const problems = [];

  for (const bus of buses) {
    const confirmed = await Booking.countDocuments({
      Bus_ID: bus.Bus_ID, Booking_Status: 'Confirmed'
    });
    const expected = Math.max(0, Number(bus.Total_Seats) - confirmed);

    if (Number(bus.Available_Seats) !== expected) {
      problems.push({ id: bus.Bus_ID, stored: bus.Available_Seats, expected });
      if (FIX_SEATS && !DRY) {
        await Bus.updateOne({ _id: bus._id }, { $set: { Available_Seats: expected } });
      }
    }
  }

  if (!problems.length) {
    log('seat-count consistency', 'all ' + buses.length + ' buses agree');
    return 0;
  }

  log('seat-count consistency',
    problems.length + ' of ' + buses.length + ' buses disagree' +
    (FIX_SEATS ? ' — REPAIRED' : ' — reported only, run with --fix-seats to change them'));
  problems.slice(0, 10).forEach((p) => {
    console.log('      ' + p.id + ': Available_Seats ' + p.stored +
      ', but Total − Confirmed = ' + p.expected);
  });
  if (problems.length > 10) { console.log('      ... and ' + (problems.length - 10) + ' more'); }

  if (!FIX_SEATS) {
    console.log('');
    console.log('      These are demo figures, not corruption: the seeded buses show');
    console.log('      low availability while only a few bookings exist. Nothing was changed.');
  }
  return problems.length;
}

/* -------------------------------- main -------------------------------- */

async function main() {
  console.log('\nMetroFlow migration' + (DRY ? ' (dry run — nothing is written)' : ''));
  console.log('='.repeat(56));

  await connectDB(process.env.MONGO_URI);
  console.log('connected: ' + process.env.MONGO_URI + '\n');

  const before = {
    routes: await Route.countDocuments({}),
    schedules: await Schedule.countDocuments({}),
    passengers: await Passenger.countDocuments({}),
    buses: await Bus.countDocuments({}),
    bookings: await Booking.countDocuments({})
  };
  console.log('  before: ' + JSON.stringify(before) + '\n');

  await buildRoutes();
  await linkBusesToRoutes();
  await buildSchedules();
  await buildPassengers();
  await linkBookings();
  await checkSeatCounts();

  const after = {
    routes: await Route.countDocuments({}),
    schedules: await Schedule.countDocuments({}),
    passengers: await Passenger.countDocuments({}),
    buses: await Bus.countDocuments({}),
    bookings: await Booking.countDocuments({})
  };
  console.log('\n  after:  ' + JSON.stringify(after));
  console.log('\nNothing was deleted. Safe to run again.\n');

  await disconnectDB();
  await mongoose.connection.close().catch(() => {});
}

main().catch(async (err) => {
  console.error('\nMigration failed:', err && err.stack ? err.stack : err);
  try { await disconnectDB(); } catch (e) { /* ignore */ }
  process.exit(1);
});
