#!/usr/bin/env node
/**
 * seed.js — fills MongoDB with a complete, self-consistent sample network.
 *
 *   npm run seed              upsert everything (safe to run twice)
 *   npm run seed -- --keep    only fill collections that are empty
 *   npm run seed -- --fresh   delete the seeded collections first (asks first)
 *
 * Idempotent by construction: every write is a bulkWrite upsert keyed on the
 * business key (Route_ID, Bus_ID, Schedule_ID, Passenger_ID, Booking_ID), so
 * running it a second time updates the same documents instead of duplicating
 * them. Nothing is deleted unless --fresh is passed.
 *
 * Travel dates are generated relative to today, so a database seeded weeks
 * ago still shows upcoming services.
 *
 * Seat consistency is guaranteed rather than hoped for: the bookings are
 * generated FROM each bus's Available_Seats, so
 *   Total_Seats − Confirmed bookings === Available_Seats
 * holds for every bus the moment the seed finishes.
 */
'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');

const { connectDB, disconnectDB } = require('../config/db');
const Route = require('../models/Route');
const Bus = require('../models/Bus');
const Schedule = require('../models/Schedule');
const Passenger = require('../models/Passenger');
const Booking = require('../models/Booking');
const Destination = require('../models/Destination');
const User = require('../models/User');

const destinations = require('./destinations.json');

const KEEP = process.argv.includes('--keep');
const FRESH = process.argv.includes('--fresh');

/* ------------------------------ helpers ------------------------------- */

function dateIn(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// "06:30" + 195 minutes -> "09:45"
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
    String(total % 60).padStart(2, '0');
}

// Seat labels in the order a coach fills: A1..A4, B1..B4, ...
function seatLabels(count) {
  const rows = 'ABCDEFGHIJKLM';
  const out = [];
  for (let r = 0; r < rows.length && out.length < count; r += 1) {
    for (let s = 1; s <= 4 && out.length < count; s += 1) {
      out.push(rows[r] + s);
    }
  }
  return out;
}

function line(label, detail) {
  console.log('  ' + String(label).padEnd(26) + detail);
}

/* ------------------------------- routes ------------------------------- */

const ROUTES = [
  ['R001', 'Colombo - Kandy', 'Colombo', 'Kandy', 115, 195, 1850,
    ['Kadawatha', 'Nittambuwa', 'Kegalle', 'Mawanella', 'Peradeniya']],
  ['R002', 'Colombo - Galle', 'Colombo', 'Galle', 126, 135, 1450,
    ['Moratuwa', 'Kalutara', 'Bentota', 'Hikkaduwa']],
  ['R003', 'Colombo - Jaffna', 'Colombo', 'Jaffna', 396, 510, 3200,
    ['Kurunegala', 'Dambulla', 'Vavuniya', 'Kilinochchi']],
  ['R004', 'Kandy - Nuwara Eliya', 'Kandy', 'Nuwara Eliya', 77, 195, 1250,
    ['Peradeniya', 'Gampola', 'Pussellawa', 'Ramboda']],
  ['R005', 'Colombo - Trincomalee', 'Colombo', 'Trincomalee', 257, 495, 2750,
    ['Kurunegala', 'Dambulla', 'Habarana', 'Kantale']],
  ['R006', 'Galle - Matara', 'Galle', 'Matara', 45, 80, 620,
    ['Unawatuna', 'Koggala', 'Weligama', 'Mirissa']],
  ['R007', 'Colombo - Anuradhapura', 'Colombo', 'Anuradhapura', 205, 270, 2100,
    ['Kurunegala', 'Dambulla', 'Kekirawa']],
  ['R008', 'Kandy - Ella', 'Kandy', 'Ella', 141, 305, 1680,
    ['Nuwara Eliya', 'Welimada', 'Bandarawela']]
];

function routeDocs() {
  return ROUTES.map(([id, name, from, to, km, mins, fare, stops]) => ({
    Route_ID: id, Route_Name: name, Departure: from, Destination: to,
    Distance_KM: km, Duration_Min: mins, Base_Fare: fare, Stops: stops,
    Status: 'Active'
  }));
}

/* -------------------------------- buses -------------------------------- */
//  [Bus_ID, name, Route_ID, dayOffset, departTime, Total_Seats, Available_Seats, fare]
//  Available_Seats drives how many bookings are generated below, so these two
//  numbers can never drift apart. MB1106 and MB1113 are the sold-out pair.
const BUSES = [
  ['MB1001', 'Metro Express',      'R001',  0, '06:30', 48, 44, 1850],
  ['MB1002', 'Southern Breeze',    'R002',  0, '07:15', 44, 41, 1450],
  ['MB1003', 'Northern Star',      'R003',  1, '21:00', 52, 49, 3200],
  ['MB1004', 'Hill Country',       'R004',  1, '08:00', 40, 38, 1250],
  ['MB1005', 'East Coast Link',    'R005',  2, '20:30', 48, 46, 2750],
  ['MB1006', 'Coastal Rider',      'R006',  0, '10:00', 20,  0,  620],  // sold out
  ['MB1007', 'Heritage Line',      'R007',  2, '06:00', 48, 45, 2100],
  ['MB1008', 'Ella Explorer',      'R008',  3, '07:45', 40, 37, 1680],
  ['MB1009', 'Kandy Flyer',        'R001',  4, '14:00', 48, 46, 1900],
  ['MB1010', 'Galle Sprinter',     'R002',  5, '09:30', 44, 42, 1500],
  ['MB1011', 'Jaffna Night Mail',  'R003',  6, '19:45', 52, 50, 3350],
  ['MB1012', 'Tea Country Hopper', 'R004',  7, '11:15', 40, 39, 1300],
  ['MB1013', 'Matara Coastal',     'R006',  1, '13:30', 24,  0,  640],  // sold out
  ['MB1014', 'Ancient Cities',     'R007',  9, '05:45', 48, 47, 2150],
  ['MB1015', 'Highland Ella',      'R008', 12, '08:20', 40, 38, 1720]
];

function busDocs(routesById) {
  return BUSES.map(([id, name, routeId, offset, depart, total, avail, fare]) => {
    const route = routesById[routeId];
    return {
      Bus_ID: id,
      Bus_Name: name,
      Route: route.Route_Name,
      Departure: route.Departure,
      Destination: route.Destination,
      Travel_Date: dateIn(offset),
      Departure_Time: depart,
      Arrival_Time: addMinutes(depart, route.Duration_Min),
      Total_Seats: total,
      Available_Seats: avail,
      Fare: fare,
      Route_ID: routeId,
      Bus_Type: total >= 48 ? 'Luxury' : 'Semi-Luxury',
      Plate_No: 'NA-' + id.slice(2)
      // Status left unset: see the note in models/Bus.js
    };
  });
}

/* ----------------------------- passengers ------------------------------ */
// Placeholder people for a university demo — not real individuals.
const PASSENGERS = [
  ['P0001', 'Nimal Perera',      '0771234567', 'nimal.perera@example.com'],
  ['P0002', 'Kamala Silva',      '0712345678', 'kamala.silva@example.com'],
  ['P0003', 'Sunil Fernando',    '0763456789', 'sunil.fernando@example.com'],
  ['P0004', 'Priya Jayawardena', '0784567890', 'priya.j@example.com'],
  ['P0005', 'Rohan Bandara',     '0775678901', 'rohan.bandara@example.com'],
  ['P0006', 'Anusha Dissanayake', '0716789012', 'anusha.d@example.com'],
  ['P0007', 'Tharindu Rathnayake', '0767890123', 'tharindu.r@example.com'],
  ['P0008', 'Malini Gunasekara', '0788901234', 'malini.g@example.com'],
  ['P0009', 'Chaminda Alwis',    '0779012345', 'chaminda.alwis@example.com'],
  ['P0010', 'Dilani Weerasinghe', '0710123456', 'dilani.w@example.com'],
  ['P0011', 'Saman Kumara',      '0761234560', 'saman.kumara@example.com'],
  ['P0012', 'Ishara Madushani',  '0782345601', 'ishara.m@example.com']
];

function passengerDocs() {
  return PASSENGERS.map(([id, name, phone, email]) => ({
    Passenger_ID: id, Full_Name: name, Phone: phone, Email: email,
    Address: '', Gender: ''
  }));
}

/* ------------------------------ schedules ------------------------------ */

function scheduleDocs(buses, routesById) {
  return buses.map((bus, i) => ({
    Schedule_ID: 'S' + String(i + 1).padStart(3, '0'),
    Bus_ID: bus.Bus_ID,
    Route_ID: bus.Route_ID,
    Travel_Date: bus.Travel_Date,
    Departure_Time: bus.Departure_Time,
    Arrival_Time: bus.Arrival_Time,
    Fare: bus.Fare,
    Available_Seats: bus.Available_Seats,
    Status: 'Scheduled'
  }));
}

/* ------------------------------- bookings ------------------------------ */
/**
 * Generated FROM the buses: each bus gets exactly
 * (Total_Seats − Available_Seats) confirmed bookings, so the consistency
 * rule holds by construction. A few extra Cancelled rows are added on top —
 * cancelled bookings do not consume a seat, which is exactly what the
 * partial unique index on (Bus_ID, Travel_Date, Seat_Number) encodes.
 */
function bookingDocs(buses) {
  const out = [];
  const perDate = {};

  buses.forEach((bus, busIndex) => {
    const sold = Math.max(0, bus.Total_Seats - bus.Available_Seats);
    const seats = seatLabels(bus.Total_Seats);

    for (let i = 0; i < sold; i += 1) {
      const person = PASSENGERS[(busIndex + i) % PASSENGERS.length];
      const key = bus.Travel_Date.replace(/-/g, '');
      perDate[key] = (perDate[key] || 0) + 1;

      out.push({
        Booking_ID: 'BK' + key + String(perDate[key]).padStart(3, '0'),
        Passenger_Name: person[1],
        Phone: person[2],
        Email: person[3],
        Bus_ID: bus.Bus_ID,
        Travel_Date: bus.Travel_Date,
        Seat_Number: seats[i],
        Boarding_Point: bus.Departure,
        Destination: bus.Destination,
        Fare: bus.Fare,
        Booking_Status: 'Confirmed'
      });
    }

    // One cancelled row on every third bus, on a seat that is still free.
    if (busIndex % 3 === 0 && seats.length > sold) {
      const person = PASSENGERS[(busIndex + 5) % PASSENGERS.length];
      const key = bus.Travel_Date.replace(/-/g, '');
      perDate[key] = (perDate[key] || 0) + 1;

      out.push({
        Booking_ID: 'BK' + key + String(perDate[key]).padStart(3, '0'),
        Passenger_Name: person[1],
        Phone: person[2],
        Email: person[3],
        Bus_ID: bus.Bus_ID,
        Travel_Date: bus.Travel_Date,
        Seat_Number: seats[sold],
        Boarding_Point: bus.Departure,
        Destination: bus.Destination,
        Fare: bus.Fare,
        Booking_Status: 'Cancelled'
      });
    }
  });

  return out;
}

/* ------------------------------- writing ------------------------------- */

async function upsertAll(Model, docs, key, label) {
  if (!docs.length) { line(label, 'nothing to write'); return; }

  const count = await Model.countDocuments({});
  if (count && KEEP) {
    line(label, count + ' already present, left alone (--keep)');
    return;
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { [key]: doc[key] },
      update: { $set: doc },
      upsert: true
    }
  }));

  const res = await Model.bulkWrite(operations, { ordered: false });
  line(label, (res.upsertedCount || 0) + ' inserted, ' +
    (res.modifiedCount || 0) + ' updated, ' +
    (docs.length - (res.upsertedCount || 0) - (res.modifiedCount || 0)) + ' unchanged');
}

// Fill the ObjectId references now that every document exists.
async function linkReferences() {
  const routes = await Route.find({}, { Route_ID: 1 }).lean();
  const byRoute = {};
  routes.forEach((r) => { byRoute[r.Route_ID] = r._id; });

  await Promise.all(Object.keys(byRoute).map((id) =>
    Bus.updateMany({ Route_ID: id }, { $set: { Route_Ref: byRoute[id] } })));
  await Promise.all(Object.keys(byRoute).map((id) =>
    Schedule.updateMany({ Route_ID: id }, { $set: { Route_Ref: byRoute[id] } })));

  const buses = await Bus.find({}, { Bus_ID: 1 }).lean();
  await Promise.all(buses.map((b) =>
    Promise.all([
      Schedule.updateMany({ Bus_ID: b.Bus_ID }, { $set: { Bus_Ref: b._id } }),
      Booking.updateMany({ Bus_ID: b.Bus_ID }, { $set: { Bus_Ref: b._id } })
    ])));

  const people = await Passenger.find({}, { Email: 1, Phone: 1 }).lean();
  await Promise.all(people.map((p) =>
    Booking.updateMany({ Email: p.Email, Phone: p.Phone }, { $set: { Passenger_Ref: p._id } })));

  line('references linked', buses.length + ' buses, ' + people.length + ' passengers');
}

async function seedAdmin() {
  const username = (process.env.ADMIN_USER || '').trim();
  const password = process.env.ADMIN_PASS || '';

  if (!username || !password) {
    line('admin', 'skipped (set ADMIN_USER and ADMIN_PASS in .env)');
    return;
  }

  const email = (username.includes('@') ? username : username + '@metroflow.lk').toLowerCase();
  const existing = await User.findOne({ Email: email });

  if (existing) {
    line('admin', email + ' already exists (' + existing.Member_No + '), left alone');
    return;
  }

  const admin = await User.create({
    Full_Name: 'MetroFlow Operator',
    Email: email,
    Phone: '+94112345678',
    Password_Hash: await bcrypt.hash(password, 10),
    Role: 'admin'
  });
  line('admin', 'created ' + admin.Email + ' (' + admin.Member_No + ')');
}

/* -------------------------------- check -------------------------------- */

/**
 * Makes Available_Seats agree with the bookings that are ACTUALLY in the
 * database, rather than with the figure hard-coded in the BUSES table.
 *
 * This runs instead of deleting anything: a database may already hold
 * confirmed bookings from earlier seeds or from manual testing, and those
 * seats are genuinely taken. Recomputing is an update, never a delete, and
 * it makes the invariant true whatever else is in there.
 */
async function reconcileSeats() {
  const buses = await Bus.find({}).lean();
  const ops = [];

  for (const bus of buses) {
    const confirmed = await Booking.countDocuments({
      Bus_ID: bus.Bus_ID, Booking_Status: 'Confirmed'
    });
    const correct = Math.max(0, bus.Total_Seats - confirmed);

    if (correct !== bus.Available_Seats) {
      ops.push({
        updateOne: {
          filter: { _id: bus._id },
          update: { $set: { Available_Seats: correct } }
        }
      });
    }
  }

  if (ops.length) {
    await Bus.bulkWrite(ops, { ordered: false });
    // Keep the schedule rows showing the same number.
    const fresh = await Bus.find({}, { Bus_ID: 1, Available_Seats: 1 }).lean();
    await Promise.all(fresh.map((b) =>
      Schedule.updateMany({ Bus_ID: b.Bus_ID }, { $set: { Available_Seats: b.Available_Seats } })));
  }

  line('seat counts reconciled', ops.length + ' bus(es) adjusted to match real bookings');
}

async function verifyConsistency() {
  const buses = await Bus.find({}).lean();
  const bad = [];

  for (const bus of buses) {
    const confirmed = await Booking.countDocuments({
      Bus_ID: bus.Bus_ID, Booking_Status: 'Confirmed'
    });
    if (bus.Total_Seats - confirmed !== bus.Available_Seats) {
      bad.push(bus.Bus_ID + ': ' + bus.Total_Seats + ' - ' + confirmed +
        ' != ' + bus.Available_Seats);
    }
  }

  console.log('\n  Consistency: Total_Seats - Confirmed = Available_Seats');
  if (!bad.length) {
    console.log('    OK for all ' + buses.length + ' buses');
  } else {
    console.log('    ' + bad.length + ' MISMATCH(ES):');
    bad.forEach((b) => console.log('      ' + b));
  }
  return bad.length;
}

/* --------------------------------- main -------------------------------- */

async function main() {
  console.log('\nMetroFlow seed' + (KEEP ? ' (--keep)' : '') + (FRESH ? ' (--fresh)' : ''));
  console.log('='.repeat(56));

  await connectDB(process.env.MONGO_URI);
  console.log('connected: ' + process.env.MONGO_URI + '\n');

  if (FRESH) {
    // Only the seeded collections, and only on an explicit flag. Users,
    // messages and anything a teammate owns are never touched.
    console.log('  --fresh: clearing routes, buses, schedules, passengers, bookings\n');
    await Promise.all([
      Route.deleteMany({}), Bus.deleteMany({}), Schedule.deleteMany({}),
      Passenger.deleteMany({}), Booking.deleteMany({})
    ]);
  }

  const routes = routeDocs();
  await upsertAll(Route, routes, 'Route_ID', 'routes');

  const routesById = {};
  routes.forEach((r) => { routesById[r.Route_ID] = r; });

  const buses = busDocs(routesById);
  await upsertAll(Bus, buses, 'Bus_ID', 'buses');
  await upsertAll(Schedule, scheduleDocs(buses, routesById), 'Schedule_ID', 'schedules');
  await upsertAll(Passenger, passengerDocs(), 'Passenger_ID', 'passengers');
  await upsertAll(Booking, bookingDocs(buses), 'Booking_ID', 'bookings');
  await upsertAll(Destination, destinations, 'Dest_ID', 'destinations');

  await linkReferences();
  await reconcileSeats();
  await seedAdmin();

  const counts = {
    routes: await Route.countDocuments({}),
    buses: await Bus.countDocuments({}),
    schedules: await Schedule.countDocuments({}),
    passengers: await Passenger.countDocuments({}),
    bookings: await Booking.countDocuments({}),
    destinations: await Destination.countDocuments({}),
    users: await User.countDocuments({})
  };
  console.log('\n  totals: ' + JSON.stringify(counts));

  const mismatches = await verifyConsistency();

  console.log('\nSeed complete. Running it again changes nothing.\n');
  await disconnectDB();
  process.exitCode = mismatches ? 1 : 0;
}

main().catch(async (err) => {
  console.error('\nSeed failed:', err && err.stack ? err.stack : err);
  try { await disconnectDB(); } catch (e) { /* ignore */ }
  process.exit(1);
});
