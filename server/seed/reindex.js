#!/usr/bin/env node
/**
 * reindex.js — drops indexes whose DEFINITION changed in the models and lets
 * Mongoose rebuild them.  `node server/seed/reindex.js`
 *
 * Changing `unique: true` to `unique + sparse` in a schema does not alter an
 * index that already exists in MongoDB, so the old one keeps rejecting rows
 * (passengers.NIC_1 rejected a second document with no NIC at all). Only
 * index metadata is touched here — no document is read, changed or deleted.
 */
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

// collection -> index names that must be rebuilt from the current schema
const STALE = {
  passengers: ['NIC_1']
};

async function main() {
  console.log('\nMetroFlow index rebuild');
  console.log('='.repeat(48));

  await connectDB(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const names = (await db.listCollections().toArray()).map((c) => c.name);

  for (const [collection, indexes] of Object.entries(STALE)) {
    if (names.indexOf(collection) === -1) {
      console.log('  skip   ' + collection + ' (collection does not exist yet)');
      continue;
    }

    const existing = (await db.collection(collection).indexes()).map((i) => i.name);

    for (const index of indexes) {
      if (existing.indexOf(index) === -1) {
        console.log('  ok     ' + collection + '.' + index + ' already absent');
        continue;
      }
      await db.collection(collection).dropIndex(index);
      console.log('  droppd ' + collection + '.' + index + ' (will be rebuilt from the model)');
    }
  }

  // Rebuild from the current schemas.
  require('../models/Passenger');
  require('../models/Bus');
  require('../models/Booking');
  require('../models/Route');
  require('../models/Schedule');

  for (const name of Object.keys(mongoose.models)) {
    try {
      await mongoose.models[name].syncIndexes();
      console.log('  synced ' + name);
    } catch (err) {
      console.warn('  WARN   ' + name + ' – ' + err.message);
    }
  }

  console.log('\nNo documents were touched.\n');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('\nReindex failed:', err && err.message ? err.message : err);
  try { await disconnectDB(); } catch (e) { /* ignore */ }
  process.exit(1);
});
