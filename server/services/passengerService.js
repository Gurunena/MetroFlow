// passengerService.js – business logic for managing passengers (Member 3)
const Passenger = require('../models/Passenger');
const Counter = require('../models/Counter');

const { NIC_RE, PHONE_RE, EMAIL_RE, GENDERS } = Passenger;

// Error that carries an HTTP status – the controller turns it into a JSON response
class ServiceError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ID_RE = /^P\d{4,}$/;
const FIELDS = ['Full_Name', 'NIC', 'Phone', 'Email', 'Address', 'Gender'];
const HIDE_ID = '-_id';

/* ---------- small helpers ---------- */

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Copy only the allowed fields. Objects/arrays are rejected so that values
// such as {"$gt": ""} can never reach a query or update.
function pick(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceError(400, 'Request body must be a JSON object');
  }
  const out = {};
  FIELDS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return;
    const value = body[key];
    if (value !== null && typeof value === 'object') {
      throw new ServiceError(400, key + ' must be a simple value, not an object or array');
    }
    out[key] = value === null ? '' : String(value).trim();
  });
  if (out.Phone !== undefined) out.Phone = out.Phone.replace(/[\s-]/g, '');
  if (out.NIC !== undefined) out.NIC = out.NIC.toUpperCase();
  return out;
}

// Collects every problem so the form can show them all at once.
// partial = only check the fields that were sent (used by update)
function validate(data, partial) {
  const details = [];
  const check = (field, ok, message) => {
    if (partial && data[field] === undefined) return;
    if (!ok) details.push({ field, message });
  };
  check('Full_Name', data.Full_Name && data.Full_Name.length >= 2 && data.Full_Name.length <= 60,
    'Full name must be 2-60 characters');
  check('NIC', data.NIC && NIC_RE.test(data.NIC),
    'NIC must be 9 digits + V/X, 12 digits, or a passport number like N1234567');
  check('Phone', data.Phone && PHONE_RE.test(data.Phone), 'Phone must look like +94771234567 or 0771234567');
  check('Email', data.Email && EMAIL_RE.test(data.Email), 'Email is not valid');
  if (data.Address !== undefined && data.Address.length > 150) {
    details.push({ field: 'Address', message: 'Address must be at most 150 characters' });
  }
  if (data.Gender !== undefined && GENDERS.indexOf(data.Gender) === -1) {
    details.push({ field: 'Gender', message: 'Gender must be Male, Female or Other' });
  }
  if (details.length) throw new ServiceError(400, details[0].message, details);
}

function normalizeId(value) {
  const id = String(value == null ? '' : value).trim().toUpperCase();
  if (!ID_RE.test(id)) throw new ServiceError(400, 'Invalid Passenger_ID – it looks like P0001');
  return id;
}

// Passenger ID = "P" + 4-digit running number: P0001, P0002, ...
async function generatePassengerId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'passenger' },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return 'P' + String(counter.seq).padStart(4, '0');
}

async function nicTaken(nic, exceptId) {
  const filter = { NIC: nic };
  if (exceptId) filter.Passenger_ID = { $ne: exceptId };
  return Passenger.exists(filter);
}

/* ---------- 1. Add passenger ---------- */
async function createPassenger(body) {
  const data = pick(body);
  validate(data, false);
  if (await nicTaken(data.NIC)) {
    throw new ServiceError(409, 'A passenger with NIC / Passport ' + data.NIC + ' already exists');
  }
  try {
    const passenger = await Passenger.create({ Passenger_ID: await generatePassengerId(), ...data });
    return passenger.toJSON();
  } catch (err) {
    if (err && err.code === 11000) throw new ServiceError(409, 'That NIC / Passport is already registered');
    throw err;
  }
}

/* ---------- 2. View all passengers (optional ?search=) ---------- */
function listPassengers(search) {
  const filter = {};
  const text = typeof search === 'string' ? search.trim() : '';
  if (text) {
    const re = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ Passenger_ID: re }, { Full_Name: re }, { NIC: re }, { Phone: re }, { Email: re }];
  }
  return Passenger.find(filter).select(HIDE_ID).sort({ Passenger_ID: 1 }).lean();
}

/* ---------- 3. View one passenger ---------- */
async function getPassengerById(passengerId) {
  const passenger = await Passenger.findOne({ Passenger_ID: normalizeId(passengerId) }).select(HIDE_ID).lean();
  if (!passenger) throw new ServiceError(404, 'Passenger not found');
  return passenger;
}

/* ---------- 4. Update passenger ---------- */
async function updatePassenger(passengerId, body) {
  const id = normalizeId(passengerId);
  const changes = pick(body);
  if (!Object.keys(changes).length) {
    throw new ServiceError(400, 'Supply at least one of: ' + FIELDS.join(', '));
  }
  validate(changes, true);

  const passenger = await Passenger.findOne({ Passenger_ID: id });
  if (!passenger) throw new ServiceError(404, 'Passenger not found');
  if (changes.NIC && await nicTaken(changes.NIC, id)) {
    throw new ServiceError(409, 'A passenger with NIC / Passport ' + changes.NIC + ' already exists');
  }

  passenger.set(changes);
  try {
    await passenger.save(); // schema validators run here
  } catch (err) {
    if (err && err.code === 11000) throw new ServiceError(409, 'That NIC / Passport is already registered');
    throw err;
  }
  return passenger.toJSON();
}

/* ---------- 5. Delete passenger ---------- */
async function deletePassenger(passengerId) {
  const id = normalizeId(passengerId);
  const passenger = await Passenger.findOneAndDelete({ Passenger_ID: id });
  if (!passenger) throw new ServiceError(404, 'Passenger not found');
  return passenger.toJSON();
}

module.exports = {
  ServiceError,
  createPassenger,
  listPassengers,
  getPassengerById,
  updatePassenger,
  deletePassenger
};
