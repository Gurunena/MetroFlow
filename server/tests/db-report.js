#!/usr/bin/env node
/**
 * db-report.js — the mongosh checks the brief asks for, as a Node script
 * because mongosh is not installed on this machine.
 *
 *   node server/tests/db-report.js
 *
 * Prints db.getCollectionNames(), one sample document per collection,
 * db.bookings.getIndexes(), and the seat-consistency rule. Read-only.
 */
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

function head(title) {
  console.log('\n' + title);
  console.log('-'.repeat(Math.max(title.length, 56)));
}

function redact(doc) {
  const out = Object.assign({}, doc);
  if (out.Password_Hash) {
    out.Password_Hash = String(out.Password_Hash).slice(0, 7) + '…(bcrypt, hidden)';
  }
  return out;
}

async function main() {
  await connectDB(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  head('> db.getCollectionNames()');
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(JSON.stringify(names, null, 2));

  head('> one document per collection');
  for (const name of names) {
    const doc = await db.collection(name).findOne({});
    const count = await db.collection(name).countDocuments();
    console.log('\n  ' + name + '  (' + count + ' document' + (count === 1 ? '' : 's') + ')');
    if (!doc) { console.log('    (empty)'); continue; }
    console.log(JSON.stringify(redact(doc), null, 2).split('\n').map((l) => '    ' + l).join('\n'));
  }

  head('> db.bookings.getIndexes()');
  const bookingIndexes = await db.collection('bookings').indexes();
  bookingIndexes.forEach((i) => {
    const extra = [];
    if (i.unique) { extra.push('unique'); }
    if (i.sparse) { extra.push('sparse'); }
    if (i.partialFilterExpression) {
      extra.push('partial ' + JSON.stringify(i.partialFilterExpression));
    }
    console.log('  ' + String(i.name).padEnd(40) + JSON.stringify(i.key) +
      (extra.length ? '   [' + extra.join(', ') + ']' : ''));
  });

  head('> indexes on every other collection');
  for (const name of names) {
    if (name === 'bookings') { continue; }
    const idx = await db.collection(name).indexes();
    console.log('  ' + name + ': ' + idx.map((i) => i.name).join(', '));
  }

  head('> consistency: Total_Seats - Confirmed bookings = Available_Seats');
  const buses = await db.collection('buses').find({}).toArray();
  const bad = [];
  for (const bus of buses) {
    const confirmed = await db.collection('bookings').countDocuments({
      Bus_ID: bus.Bus_ID, Booking_Status: 'Confirmed'
    });
    const expected = bus.Total_Seats - confirmed;
    if (expected !== bus.Available_Seats) {
      bad.push('    ' + bus.Bus_ID + ': ' + bus.Total_Seats + ' - ' + confirmed +
        ' = ' + expected + ', but Available_Seats = ' + bus.Available_Seats);
    }
  }
  if (bad.length) {
    console.log('  ' + bad.length + ' MISMATCH(ES):');
    bad.forEach((b) => console.log(b));
  } else {
    console.log('  OK for all ' + buses.length + ' buses');
  }

  head('> referential integrity');
  const [busNoRoute, bookNoBus, bookNoPax, schedNoBus] = await Promise.all([
    db.collection('buses').countDocuments({ $or: [{ Route_Ref: null }, { Route_Ref: { $exists: false } }] }),
    db.collection('bookings').countDocuments({ $or: [{ Bus_Ref: null }, { Bus_Ref: { $exists: false } }] }),
    db.collection('bookings').countDocuments({ $or: [{ Passenger_Ref: null }, { Passenger_Ref: { $exists: false } }] }),
    db.collection('schedules').countDocuments({ $or: [{ Bus_Ref: null }, { Bus_Ref: { $exists: false } }] })
  ]);
  console.log('  buses without Route_Ref      : ' + busNoRoute);
  console.log('  bookings without Bus_Ref     : ' + bookNoBus);
  console.log('  bookings without Passenger_Ref: ' + bookNoPax);
  console.log('  schedules without Bus_Ref    : ' + schedNoBus);

  console.log('');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('db-report failed:', err && err.message ? err.message : err);
  try { await disconnectDB(); } catch (e) { /* ignore */ }
  process.exit(1);
});
