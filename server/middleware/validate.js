// validate.js – request validation and input sanitising for every write route
//
// No extra packages: express-validator is not a dependency of this project
// and the deadline is tonight, so these are plain middleware functions.
//
// Every validator answers the shape the brief fixes:
//   400 { success: false, message: "Validation failed",
//         errors: [{ field, message }] }
'use strict';

/* ============================== primitives ============================= */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BUS_ID_RE = /^[A-Z]{2}\d{3,6}$/;
const ROUTE_ID_RE = /^R\d{3,5}$/;
const SCHED_ID_RE = /^S\d{3,5}$/;
const PAX_ID_RE = /^P\d{4,6}$/;
const BOOKING_ID_RE = /^BK\d{8}\d{3}$/;
const SEAT_RE = /^[A-M][1-4]$/;
const PHONE_RE = /^(\+94|0)7\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(res, errors) {
  return res.status(400).json({ success: false, message: 'Validation failed', errors });
}

function isPlainString(v) {
  return typeof v === 'string';
}

/**
 * A real calendar date, not just the right shape: 2026-02-31 is rejected.
 */
function isRealDate(value) {
  if (!isPlainString(value) || !DATE_RE.test(value)) { return false; }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/* ============================== sanitising ============================= */

/**
 * Strips the keys an attacker uses to turn a value into a query operator:
 * anything starting with "$" ({"$ne": null}) or containing "." (dotted
 * path injection). Runs over body, query and params on every request.
 *
 * req.query is a getter on Express 5 / newer Node, so the cleaned object is
 * assigned back defensively rather than mutated in place where possible.
 */
function stripOperators(value, depth) {
  if (depth > 6 || value === null || typeof value !== 'object') { return value; }

  if (Array.isArray(value)) {
    return value.map((v) => stripOperators(v, depth + 1));
  }

  const out = {};
  Object.keys(value).forEach((key) => {
    if (key.charCodeAt(0) === 36 || key.indexOf('.') > -1) { return; }  // $ or .
    out[key] = stripOperators(value[key], depth + 1);
  });
  return out;
}

function sanitiseRequest(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = stripOperators(req.body, 0);
  }

  if (req.query && typeof req.query === 'object') {
    const cleaned = stripOperators(req.query, 0);
    try {
      req.query = cleaned;
    } catch (err) {
      // Express 5 makes req.query a getter: mutate the existing object.
      Object.keys(req.query).forEach((k) => { delete req.query[k]; });
      Object.assign(req.query, cleaned);
    }
  }

  // Path params are always strings from the router, but an array can still
  // arrive through odd encodings; force them to strings.
  if (req.params && typeof req.params === 'object') {
    Object.keys(req.params).forEach((k) => {
      if (typeof req.params[k] !== 'string') { req.params[k] = String(req.params[k]); }
    });
  }

  return next();
}

/**
 * Neutralises regex metacharacters so user input is safe inside a RegExp.
 * Without this, a search for ".*" matches every row and "(a+)+" is a ReDoS.
 */
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============================ field checking =========================== */

/**
 * Tiny declarative checker. `rules` maps a field name to a spec:
 *   { required, type, re, msg, min, max, enum, date, time, custom }
 * Unknown fields are rejected when `allowed` is given.
 */
function check(body, rules, opts) {
  const errors = [];
  const options = opts || {};
  const source = body && typeof body === 'object' ? body : {};

  if (options.rejectUnknown) {
    const allowed = Object.keys(rules);
    Object.keys(source).forEach((key) => {
      if (allowed.indexOf(key) === -1) {
        errors.push({ field: key, message: 'Unknown field "' + key + '" is not accepted' });
      }
    });
  }

  Object.keys(rules).forEach((field) => {
    const rule = rules[field];
    const value = source[field];
    const missing = value === undefined || value === null || value === '';

    if (missing) {
      if (rule.required) {
        errors.push({ field, message: rule.msg || (field.replace(/_/g, ' ') + ' is required') });
      }
      return;
    }

    if (rule.type === 'number') {
      const n = Number(value);
      if (!isFinite(n)) {
        errors.push({ field, message: field.replace(/_/g, ' ') + ' must be a number' });
        return;
      }
      if (rule.min !== undefined && n < rule.min) {
        errors.push({ field, message: field.replace(/_/g, ' ') + ' must be at least ' + rule.min });
      }
      if (rule.max !== undefined && n > rule.max) {
        errors.push({ field, message: field.replace(/_/g, ' ') + ' must be at most ' + rule.max });
      }
      return;
    }

    if (rule.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ field, message: field.replace(/_/g, ' ') + ' must be a list' });
      }
      return;
    }

    // Everything else must be a plain string: an object here is an
    // injection attempt, not a typo.
    if (!isPlainString(value)) {
      errors.push({ field, message: field.replace(/_/g, ' ') + ' must be text' });
      return;
    }

    const text = value.trim();

    if (rule.date && !isRealDate(text)) {
      errors.push({ field, message: rule.msg || (field.replace(/_/g, ' ') + ' must be a real date as YYYY-MM-DD') });
      return;
    }
    if (rule.time && !TIME_RE.test(text)) {
      errors.push({ field, message: rule.msg || (field.replace(/_/g, ' ') + ' must be a time as HH:mm') });
      return;
    }
    if (rule.re && !rule.re.test(text)) {
      errors.push({ field, message: rule.msg || (field.replace(/_/g, ' ') + ' is not in the expected format') });
      return;
    }
    if (rule.enum && rule.enum.indexOf(text) === -1) {
      errors.push({ field, message: field.replace(/_/g, ' ') + ' must be one of: ' + rule.enum.join(', ') });
      return;
    }
    if (rule.min !== undefined && text.length < rule.min) {
      errors.push({ field, message: field.replace(/_/g, ' ') + ' must be at least ' + rule.min + ' characters' });
      return;
    }
    if (rule.max !== undefined && text.length > rule.max) {
      errors.push({ field, message: field.replace(/_/g, ' ') + ' must be at most ' + rule.max + ' characters' });
      return;
    }
    if (rule.custom) {
      const problem = rule.custom(text, source);
      if (problem) { errors.push({ field, message: problem }); }
    }
  });

  return errors;
}

// Trim every top-level string so " Colombo " never reaches the database.
function trimStrings(body) {
  if (!body || typeof body !== 'object') { return; }
  Object.keys(body).forEach((k) => {
    if (typeof body[k] === 'string') { body[k] = body[k].trim(); }
  });
}

/* ============================== validators ============================= */

const BUS_RULES = {
  Bus_ID: { required: true, re: BUS_ID_RE, msg: 'Bus_ID must look like MB1001' },
  Bus_Name: { required: true, min: 2, max: 60 },
  Route: { required: true, min: 3, max: 80 },
  Departure: { required: true, min: 2, max: 60 },
  Destination: { required: true, min: 2, max: 60 },
  Travel_Date: { required: true, date: true },
  Departure_Time: { required: true, time: true },
  Arrival_Time: { required: true, time: true },
  Total_Seats: { required: true, type: 'number', min: 1, max: 52 },
  Available_Seats: { type: 'number', min: 0, max: 52 },
  Fare: { required: true, type: 'number', min: 0 },
  Route_ID: { re: ROUTE_ID_RE, msg: 'Route_ID must look like R001' },
  Bus_Type: { max: 40 },
  Plate_No: { max: 20 },
  Status: { enum: ['Active', 'Inactive'] }
};

function timesOrdered(body, errors) {
  if (body.Departure_Time && body.Arrival_Time &&
      TIME_RE.test(body.Departure_Time) && TIME_RE.test(body.Arrival_Time) &&
      body.Arrival_Time <= body.Departure_Time) {
    errors.push({
      field: 'Arrival_Time',
      message: 'Arrival_Time must be after Departure_Time'
    });
  }
}

function validateBusCreate(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, BUS_RULES, { rejectUnknown: true });
  timesOrdered(req.body, errors);

  const total = Number(req.body.Total_Seats);
  const avail = req.body.Available_Seats;
  if (avail !== undefined && avail !== '' && isFinite(Number(avail)) && isFinite(total) &&
      Number(avail) > total) {
    errors.push({ field: 'Available_Seats', message: 'Available_Seats cannot exceed Total_Seats' });
  }

  return errors.length ? fail(res, errors) : next();
}

function validateBusUpdate(req, res, next) {
  trimStrings(req.body);
  // Nothing is required on an update, and Bus_ID is immutable.
  const rules = {};
  Object.keys(BUS_RULES).forEach((k) => {
    if (k === 'Bus_ID') { return; }
    rules[k] = Object.assign({}, BUS_RULES[k], { required: false });
  });

  const errors = check(req.body, rules, { rejectUnknown: true });
  timesOrdered(req.body, errors);

  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send at least one field to update' });
  }
  return errors.length ? fail(res, errors) : next();
}

function validateSchedule(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, {
    Travel_Date: { date: true },
    Departure_Time: { time: true },
    Arrival_Time: { time: true },
    Fare: { type: 'number', min: 0 }
  }, { rejectUnknown: true });

  timesOrdered(req.body, errors);

  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send Travel_Date, Departure_Time or Arrival_Time' });
  }
  return errors.length ? fail(res, errors) : next();
}

function validateDateParam(req, res, next) {
  const date = req.params.date;
  if (!isRealDate(date)) {
    return fail(res, [{ field: 'date', message: 'Date must be a real date as YYYY-MM-DD' }]);
  }
  return next();
}

/* ------------------------------- bookings ------------------------------ */

const BOOKING_CREATE_RULES = {
  Passenger_Name: { required: true, min: 2, max: 60 },
  Phone: { required: true, re: PHONE_RE, msg: 'Phone must look like 0771234567 or +94771234567' },
  Email: { required: true, re: EMAIL_RE, msg: 'Email is not valid', max: 100 },
  Bus_ID: { required: true, re: BUS_ID_RE, msg: 'Bus_ID must look like MB1001' },
  Seat_Number: { required: true, re: SEAT_RE, msg: 'Seat must look like A1 (rows A–M, seats 1–4)' },
  Boarding_Point: { required: true, min: 2, max: 60 },
  // Accepted but ignored: the server reads these from the bus so a client
  // cannot choose its own fare. Listed here only so they are not rejected
  // as unknown fields by older front-end code that still sends them.
  Travel_Date: { date: true },
  Destination: { max: 60 },
  Fare: { type: 'number', min: 0 },
  Schedule_ID: { re: SCHED_ID_RE }
};

function validateBookingCreate(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, BOOKING_CREATE_RULES, { rejectUnknown: true });
  return errors.length ? fail(res, errors) : next();
}

function validateBookingUpdate(req, res, next) {
  trimStrings(req.body);
  // Only these may be edited; Fare, Bus_ID, Travel_Date and Booking_Status
  // are server-owned.
  const errors = check(req.body, {
    Passenger_Name: { min: 2, max: 60 },
    Phone: { re: PHONE_RE, msg: 'Phone must look like 0771234567 or +94771234567' },
    Email: { re: EMAIL_RE, msg: 'Email is not valid', max: 100 },
    Seat_Number: { re: SEAT_RE, msg: 'Seat must look like A1 (rows A–M, seats 1–4)' },
    Boarding_Point: { min: 2, max: 60 }
  }, { rejectUnknown: true });

  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send at least one field to update' });
  }
  return errors.length ? fail(res, errors) : next();
}

/* -------------------------------- routes ------------------------------- */

const ROUTE_RULES = {
  Route_ID: { required: true, re: ROUTE_ID_RE, msg: 'Route_ID must look like R001' },
  Route_Name: { required: true, min: 3, max: 80 },
  Departure: { required: true, min: 2, max: 60 },
  Destination: { required: true, min: 2, max: 60 },
  Distance_KM: { required: true, type: 'number', min: 1, max: 2000 },
  Duration_Min: { required: true, type: 'number', min: 1, max: 2880 },
  Base_Fare: { required: true, type: 'number', min: 0 },
  Stops: { type: 'array' },
  Status: { enum: ['Active', 'Inactive'] }
};

function validateRouteCreate(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, ROUTE_RULES, { rejectUnknown: true });
  return errors.length ? fail(res, errors) : next();
}

function validateRouteUpdate(req, res, next) {
  trimStrings(req.body);
  const rules = {};
  Object.keys(ROUTE_RULES).forEach((k) => {
    if (k === 'Route_ID') { return; }
    rules[k] = Object.assign({}, ROUTE_RULES[k], { required: false });
  });
  const errors = check(req.body, rules, { rejectUnknown: true });
  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send at least one field to update' });
  }
  return errors.length ? fail(res, errors) : next();
}

/* ------------------------------ schedules ------------------------------ */

const SCHEDULE_RULES = {
  Schedule_ID: { required: true, re: SCHED_ID_RE, msg: 'Schedule_ID must look like S001' },
  Bus_ID: { required: true, re: BUS_ID_RE, msg: 'Bus_ID must look like MB1001' },
  Route_ID: { re: ROUTE_ID_RE, msg: 'Route_ID must look like R001' },
  Travel_Date: { required: true, date: true },
  Departure_Time: { required: true, time: true },
  Arrival_Time: { required: true, time: true },
  Fare: { type: 'number', min: 0 },
  Available_Seats: { type: 'number', min: 0, max: 52 },
  Status: { enum: ['Scheduled', 'Departed', 'Cancelled'] }
};

function validateScheduleCreate(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, SCHEDULE_RULES, { rejectUnknown: true });
  timesOrdered(req.body, errors);
  return errors.length ? fail(res, errors) : next();
}

function validateScheduleUpdate(req, res, next) {
  trimStrings(req.body);
  const rules = {};
  Object.keys(SCHEDULE_RULES).forEach((k) => {
    if (k === 'Schedule_ID') { return; }
    rules[k] = Object.assign({}, SCHEDULE_RULES[k], { required: false });
  });
  const errors = check(req.body, rules, { rejectUnknown: true });
  timesOrdered(req.body, errors);
  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send at least one field to update' });
  }
  return errors.length ? fail(res, errors) : next();
}

/* ------------------------------ passengers ----------------------------- */

const PASSENGER_RULES = {
  Passenger_ID: { re: PAX_ID_RE, msg: 'Passenger_ID must look like P0001' },
  Passenger_Name: { min: 2, max: 60 },
  Full_Name: { min: 2, max: 60 },
  Phone: { required: true, re: PHONE_RE, msg: 'Phone must look like 0771234567 or +94771234567' },
  Email: { required: true, re: EMAIL_RE, msg: 'Email is not valid', max: 100 },
  NIC: { max: 20 },
  Address: { max: 150 },
  Gender: { enum: ['Male', 'Female', 'Other', ''] },
  User_Ref: { max: 40 }
};

function validatePassengerCreate(req, res, next) {
  trimStrings(req.body);
  const errors = check(req.body, PASSENGER_RULES, { rejectUnknown: true });
  // The teammate's model calls it Full_Name; the brief calls it
  // Passenger_Name. Accept either, require one.
  if (!req.body.Passenger_Name && !req.body.Full_Name) {
    errors.push({ field: 'Passenger_Name', message: 'Passenger_Name is required' });
  }
  return errors.length ? fail(res, errors) : next();
}

function validatePassengerUpdate(req, res, next) {
  trimStrings(req.body);
  const rules = {};
  Object.keys(PASSENGER_RULES).forEach((k) => {
    if (k === 'Passenger_ID') { return; }
    rules[k] = Object.assign({}, PASSENGER_RULES[k], { required: false });
  });
  const errors = check(req.body, rules, { rejectUnknown: true });
  if (!Object.keys(req.body || {}).length) {
    errors.push({ field: 'body', message: 'Send at least one field to update' });
  }
  return errors.length ? fail(res, errors) : next();
}

module.exports = {
  // middleware
  sanitiseRequest,
  validateBusCreate,
  validateBusUpdate,
  validateSchedule,
  validateDateParam,
  validateBookingCreate,
  validateBookingUpdate,
  validateRouteCreate,
  validateRouteUpdate,
  validateScheduleCreate,
  validateScheduleUpdate,
  validatePassengerCreate,
  validatePassengerUpdate,

  // reusable helpers
  check,
  fail,
  escapeRegex,
  isRealDate,
  todayStr,
  stripOperators,
  patterns: {
    DATE_RE, TIME_RE, BUS_ID_RE, ROUTE_ID_RE, SCHED_ID_RE, PAX_ID_RE,
    BOOKING_ID_RE, SEAT_RE, PHONE_RE, EMAIL_RE
  }
};
