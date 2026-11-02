// seed.js – populates MongoDB with sample buses and bookings
//
//   npm run seed            replace the sample data
//   npm run seed -- --keep  insert only if the collection is empty
//
// Travel dates are not hard-coded. Each record carries a "_dayOffset"
// (0 = today, 1 = tomorrow, ...) which is turned into a real Travel_Date at
// insert time, so a seeded database is still useful weeks from now.
require('dotenv').config();

const buses = require('./buses.json');
const bookings = require('./bookings.json');

const bcrypt = require('bcryptjs');

const { connectDB, disconnectDB } = require('../config/db');
const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const Counter = require('../models/Counter');
const User = require('../models/User');

const keepExisting = process.argv.includes('--keep');

function dateFromOffset(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// "_dayOffset" -> "Travel_Date", and drop the helper field.
function materialise(record) {
  const { _dayOffset, ...rest } = record;
  return { ...rest, Travel_Date: dateFromOffset(_dayOffset) };
}

// Mirrors utils/idGenerator: BK + YYYYMMDD + 3-digit sequence per date.
function bookingId(travelDate, seqByDate) {
  const key = travelDate.replace(/-/g, '');
  seqByDate[key] = (seqByDate[key] || 0) + 1;
  return 'BK' + key + String(seqByDate[key]).padStart(3, '0');
}

async function seed() {
  await connectDB(process.env.MONGO_URI);
  console.log('Connected to ' + process.env.MONGO_URI);

  // ------------------------------- buses --------------------------------
  const busCount = await Bus.countDocuments();
  if (busCount && keepExisting) {
    console.log('Buses: ' + busCount + ' already present, left alone (--keep)');
  } else {
    if (busCount) {
      await Bus.deleteMany({});
      console.log('Buses: cleared ' + busCount + ' existing');
    }
    const docs = buses.map(materialise);
    await Bus.insertMany(docs, { ordered: true });
    console.log('Buses: inserted ' + docs.length);
  }

  // ------------------------------ bookings ------------------------------
  const bookingCount = await Booking.countDocuments();
  if (bookingCount && keepExisting) {
    console.log('Bookings: ' + bookingCount + ' already present, left alone (--keep)');
  } else {
    if (bookingCount) {
      await Booking.deleteMany({});
      console.log('Bookings: cleared ' + bookingCount + ' existing');
    }

    const seqByDate = {};
    const docs = bookings.map((raw) => {
      const record = materialise(raw);
      return { ...record, Booking_ID: bookingId(record.Travel_Date, seqByDate) };
    });
    await Booking.insertMany(docs, { ordered: true });
    console.log('Bookings: inserted ' + docs.length +
      ' (' + docs.map((d) => d.Booking_ID).join(', ') + ')');

    // Keep the live ID generator in step, so the next real booking does not
    // collide with a seeded Booking_ID.
    await Promise.all(Object.entries(seqByDate).map(([key, seq]) =>
      Counter.findOneAndUpdate(
        { _id: 'booking-' + key },
        { $set: { seq } },
        { upsert: true }
      )
    ));
    console.log('Counters: synced for ' + Object.keys(seqByDate).length + ' date(s)');
  }

  // ----------------------------- admin user -----------------------------
  // Idempotent on purpose: re-seeding must never clobber or duplicate the
  // operator account, and must never reset a password that has been changed.
  await seedAdmin();

  console.log('\nSeed complete.');
}

async function seedAdmin() {
  const username = (process.env.ADMIN_USER || '').trim();
  const password = process.env.ADMIN_PASS || '';

  if (!username || !password) {
    console.log('Admin: skipped (set ADMIN_USER and ADMIN_PASS in .env)');
    return;
  }

  // ADMIN_USER may be a bare name; store it as a valid email either way.
  const email = (username.includes('@') ? username : username + '@metroflow.lk').toLowerCase();

  const existing = await User.findOne({ Email: email });
  if (existing) {
    console.log('Admin: ' + email + ' already exists (' + existing.Member_No + '), left alone');
    return;
  }

  const admin = await User.create({
    Full_Name: 'MetroFlow Operator',
    Email: email,
    Phone: '+94112345678',
    Password_Hash: await bcrypt.hash(password, 10),
    Role: 'admin'
  });

  console.log('Admin: created ' + admin.Email + ' (' + admin.Member_No + ')');
}

seed()
  .catch((err) => {
    console.error('\nSeed failed: ' + err.message);
    if (err.errors) {
      Object.values(err.errors).forEach((e) => console.error('  - ' + e.message));
    }
    process.exitCode = 1;
  })
  .finally(() => disconnectDB().catch(() => {}));
