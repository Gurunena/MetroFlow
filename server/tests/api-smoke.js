#!/usr/bin/env node
/**
 * api-smoke.js — exercises every MetroFlow endpoint with valid AND invalid
 * input and prints PASS/FAIL per call.
 *
 *   node server/tests/api-smoke.js              # against http://localhost:3000
 *   BASE=http://host:port node server/tests/api-smoke.js
 *   node server/tests/api-smoke.js --audit      # audit table only, no writes
 *
 * It creates and then cleans up its own data, so it is safe to run repeatedly
 * against a seeded database.
 */
'use strict';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const AUDIT_ONLY = process.argv.indexOf('--audit') > -1;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    fail += 1;
    failures.push(label + (detail ? '  -> ' + detail : ''));
    console.log('  FAIL  ' + label + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
  console.log('-'.repeat(Math.max(title.length, 40)));
}

let token = null;

async function call(method, path, body, useAuth) {
  const headers = {};
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  if (useAuth && token) { headers.Authorization = 'Bearer ' + token; }

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    return { status: 0, body: { message: err.message }, networkError: true };
  }

  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text.slice(0, 160) }; }
  return { status: res.status, body: parsed };
}

const get = (p, a) => call('GET', p, undefined, a);
const post = (p, b, a) => call('POST', p, b, a);
const put = (p, b, a) => call('PUT', p, b, a);
const patch = (p, b, a) => call('PATCH', p, b, a);
const del = (p, a) => call('DELETE', p, undefined, a);

function today(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/* ===================================================================== */
/*  AUDIT: does every required endpoint exist and respond?               */
/* ===================================================================== */

const REQUIRED = [
  ['Buses', 'POST', '/api/buses', true],
  ['Buses', 'GET', '/api/buses', false],
  ['Buses', 'GET', '/api/buses/:busId', false],
  ['Buses', 'GET', '/api/buses/route/:route', false],
  ['Buses', 'GET', '/api/buses/departure/:departure', false],
  ['Buses', 'GET', '/api/buses/destination/:destination', false],
  ['Buses', 'GET', '/api/buses/date/:date', false],
  ['Buses', 'GET', '/api/buses/available', false],
  ['Buses', 'PUT', '/api/buses/:busId', true],
  ['Buses', 'PATCH', '/api/buses/:busId/schedule', true],
  ['Buses', 'DELETE', '/api/buses/:busId', true],

  ['Bookings', 'POST', '/api/bookings', false],
  ['Bookings', 'GET', '/api/bookings', true],
  ['Bookings', 'GET', '/api/bookings/:bookingId', false],
  ['Bookings', 'GET', '/api/bookings/passenger/:name', false],
  ['Bookings', 'GET', '/api/bookings/phone/:phone', false],
  ['Bookings', 'GET', '/api/bookings/email/:email', false],
  ['Bookings', 'GET', '/api/bookings/bus/:busId', false],
  ['Bookings', 'GET', '/api/bookings/date/:date', false],
  ['Bookings', 'PUT', '/api/bookings/:bookingId', false],
  ['Bookings', 'PATCH', '/api/bookings/:bookingId/cancel', false],

  ['Routes', 'GET', '/api/routes', false],
  ['Routes', 'GET', '/api/routes/:routeId', false],
  ['Routes', 'POST', '/api/routes', true],
  ['Routes', 'PUT', '/api/routes/:routeId', true],
  ['Routes', 'DELETE', '/api/routes/:routeId', true],

  ['Schedules', 'GET', '/api/schedules', false],
  ['Schedules', 'GET', '/api/schedules/:scheduleId', false],
  ['Schedules', 'POST', '/api/schedules', true],
  ['Schedules', 'PUT', '/api/schedules/:scheduleId', true],
  ['Schedules', 'DELETE', '/api/schedules/:scheduleId', true],

  ['Passengers', 'GET', '/api/passengers', true],
  ['Passengers', 'GET', '/api/passengers/:passengerId', true],
  ['Passengers', 'POST', '/api/passengers', true],
  ['Passengers', 'PUT', '/api/passengers/:passengerId', true],
  ['Passengers', 'DELETE', '/api/passengers/:passengerId', true],

  ['Helpers', 'GET', '/api/buses/:busId/seats', false],
  ['Helpers', 'GET', '/api/stats', true],
  ['Helpers', 'GET', '/api/health', false]
];

// A sample value for each :param so the audit can actually call the route.
async function sampleIds() {
  const buses = await get('/api/buses');
  const list = (buses.body && buses.body.data) || [];
  const bus = list[0] || {};

  const bookings = await get('/api/bookings', true);
  const bk = (((bookings.body || {}).data) || [])[0] || {};

  const routes = await get('/api/routes');
  const rt = (((routes.body || {}).data) || [])[0] || {};

  const scheds = await get('/api/schedules');
  const sc = (((scheds.body || {}).data) || [])[0] || {};

  const pax = await get('/api/passengers', true);
  const px = (((pax.body || {}).data) || [])[0] || {};

  return {
    ':busId': bus.Bus_ID || 'MB1001',
    ':route': bus.Route || 'Colombo - Kandy',
    ':departure': bus.Departure || 'Colombo',
    ':destination': bus.Destination || 'Kandy',
    ':date': bus.Travel_Date || today(),
    ':bookingId': bk.Booking_ID || 'BK20261107001',
    ':name': bk.Passenger_Name || 'Nimal',
    ':phone': bk.Phone || '0771234567',
    ':email': bk.Email || 'test@example.com',
    ':routeId': rt.Route_ID || 'R001',
    ':scheduleId': sc.Schedule_ID || 'S001',
    ':passengerId': px.Passenger_ID || 'P0001'
  };
}

// IDs that cannot exist. Destructive probes use these so the audit never
// touches real data: an unmatched path still answers the app's "No such
// endpoint" 404, while a mounted route answers its controller's own 404.
const SENTINEL = {
  ':busId': 'MB000000', ':bookingId': 'BK19000101999', ':routeId': 'R000',
  ':scheduleId': 'S000', ':passengerId': 'P0000', ':name': '__none__',
  ':phone': '0700000000', ':email': 'none@example.invalid',
  ':route': '__none__', ':departure': '__none__', ':destination': '__none__',
  ':date': '1900-01-01'
};

function fill(path, ids) {
  return path.replace(/:[a-zA-Z]+/g, (m) => encodeURIComponent(ids[m] || m));
}

async function runAudit() {
  section('ENDPOINT AUDIT — does it exist, does it respond?');
  const ids = await sampleIds();

  const rows = [];
  for (const [group, method, template, needsAuth] of REQUIRED) {
    // GET is read-only, so it may use a real id. Anything that could write or
    // delete is probed against an id that cannot exist, so this audit can be
    // run safely against a live database.
    const destructive = method !== 'GET';
    const path = fill(template, destructive ? SENTINEL : ids);
    // An empty body on POST/PUT/PATCH should answer 400 (exists, validates)
    // rather than 404 (missing).
    const res = await call(method, path, destructive && method !== 'DELETE' ? {} : undefined, needsAuth);

    let verdict;
    if (res.status === 0) { verdict = 'SERVER DOWN'; }
    else if (res.status === 404 &&
      /No such endpoint|Cannot (GET|POST|PUT|PATCH|DELETE)/i.test(JSON.stringify(res.body))) {
      verdict = 'MISSING';
    } else if (res.status === 404) { verdict = 'exists (404 no data)'; }
    else if (res.status === 401 || res.status === 403) { verdict = 'exists (auth)'; }
    else if (res.status === 400 || res.status === 409 || res.status === 422) { verdict = 'exists (validates)'; }
    else if (res.status >= 500) { verdict = 'ERROR ' + res.status; }
    else { verdict = 'OK ' + res.status; }

    rows.push({ group, call: method + ' ' + template, status: res.status, verdict });
  }

  // DELETE probes above may have destroyed the sample rows; that is why the
  // audit runs read-only ids and the functional tests create their own.
  const width = Math.max(...rows.map((r) => r.call.length)) + 2;
  let lastGroup = '';
  for (const r of rows) {
    if (r.group !== lastGroup) { console.log('\n  [' + r.group + ']'); lastGroup = r.group; }
    const bad = /MISSING|ERROR|SERVER DOWN/.test(r.verdict);
    console.log('   ' + (bad ? 'x' : 'v') + ' ' + r.call.padEnd(width) + r.verdict);
  }

  const missing = rows.filter((r) => /MISSING|ERROR|SERVER DOWN/.test(r.verdict));
  console.log('\n  ' + (rows.length - missing.length) + '/' + rows.length + ' endpoints reachable');
  if (missing.length) {
    console.log('  Missing or erroring:');
    missing.forEach((m) => console.log('    - ' + m.call + '  (' + m.verdict + ')'));
  }
  return missing;
}

/* ===================================================================== */
/*  FUNCTIONAL TESTS                                                     */
/* ===================================================================== */

async function login() {
  const email = ADMIN_USER.indexOf('@') > -1 ? ADMIN_USER : ADMIN_USER + '@metroflow.lk';
  const res = await post('/api/auth/admin-login', { Email: email, Password: ADMIN_PASS });
  token = (((res.body || {}).data) || {}).token || null;
  return res;
}

async function main() {
  console.log('MetroFlow API smoke test');
  console.log('base: ' + BASE);

  const health = await get('/api/health');
  if (health.status === 0) {
    console.log('\nServer is not reachable at ' + BASE + ' — start it with `npm start`.');
    process.exit(2);
  }

  section('AUTH');
  const li = await login();
  ok('admin-login returns 200 and a token', li.status === 200 && !!token, 'status=' + li.status);
  ok('GET /api/health is public and reports the db',
    health.status === 200 && /ok|up/.test(JSON.stringify(health.body)),
    JSON.stringify(health.body).slice(0, 120));

  await runAudit();

  if (AUDIT_ONLY) {
    console.log('\n(--audit: skipping write tests)');
    return;
  }

  /* ----------------------------- buses ------------------------------- */
  section('BUSES');
  const all = await get('/api/buses');
  ok('GET /api/buses -> 200 with {success,count,data}',
    all.status === 200 && all.body.success === true && Array.isArray(all.body.data) &&
    typeof all.body.count === 'number',
    'status=' + all.status + ' keys=' + Object.keys(all.body || {}).join(','));

  const sample = (all.body.data || [])[0] || {};
  const BUS_FIELDS = ['Bus_ID', 'Bus_Name', 'Route', 'Departure', 'Destination', 'Travel_Date',
    'Departure_Time', 'Arrival_Time', 'Total_Seats', 'Available_Seats', 'Fare'];
  ok('bus documents still carry every assignment field',
    BUS_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(sample, f)),
    'missing: ' + BUS_FIELDS.filter((f) => !(f in sample)).join(',') || '-');

  ok('GET /api/buses/:busId -> 200',
    (await get('/api/buses/' + sample.Bus_ID)).status === 200);
  ok('GET /api/buses/:busId unknown -> 404',
    (await get('/api/buses/MB000000')).status === 404);
  ok('GET /api/buses/available?from=&to=&date= -> 200',
    (await get('/api/buses/available?from=' + encodeURIComponent(sample.Departure) +
      '&to=' + encodeURIComponent(sample.Destination) + '&date=' + sample.Travel_Date)).status === 200);
  ok('GET /api/buses/date/:date -> 200',
    (await get('/api/buses/date/' + sample.Travel_Date)).status === 200);
  ok('GET /api/buses/date/:date invalid -> 400',
    (await get('/api/buses/date/not-a-date')).status === 400);
  ok('GET /api/buses/departure/:departure -> 200',
    (await get('/api/buses/departure/' + encodeURIComponent(sample.Departure))).status === 200);
  ok('GET /api/buses/destination/:destination -> 200',
    (await get('/api/buses/destination/' + encodeURIComponent(sample.Destination))).status === 200);
  ok('GET /api/buses/route/:route -> 200',
    (await get('/api/buses/route/' + encodeURIComponent(sample.Route))).status === 200);
  ok('GET /api/buses/:busId/seats -> {total,booked,available}',
    await (async () => {
      const r = await get('/api/buses/' + sample.Bus_ID + '/seats');
      const d = (r.body || {}).data || {};
      return r.status === 200 && typeof d.total === 'number' &&
        Array.isArray(d.booked) && typeof d.available === 'number';
    })());

  // regex / NoSQL injection
  const inj = await get('/api/buses/departure/' + encodeURIComponent('.*'));
  ok('regex metacharacters in a path param do not match everything',
    inj.status === 200 && (inj.body.count === 0 || inj.body.count < (all.body.count || 0)),
    'count=' + inj.body.count + ' of ' + all.body.count);

  section('BUSES — admin writes');
  const TEST_BUS = 'MB9' + String(Date.now()).slice(-4);
  const newBus = {
    Bus_ID: TEST_BUS, Bus_Name: 'Smoke Test Coach', Route: 'Colombo - Kandy',
    Departure: 'Colombo', Destination: 'Kandy', Travel_Date: today(3),
    Departure_Time: '08:00', Arrival_Time: '11:30',
    Total_Seats: 40, Available_Seats: 40, Fare: 1500
  };
  ok('POST /api/buses without a token -> 401/403',
    [401, 403].indexOf((await post('/api/buses', newBus)).status) > -1);

  const created = await post('/api/buses', newBus, true);
  ok('POST /api/buses -> 201', created.status === 201,
    'status=' + created.status + ' ' + JSON.stringify(created.body).slice(0, 140));
  ok('POST /api/buses invalid -> 400 with errors[]',
    await (async () => {
      const r = await post('/api/buses', { Bus_ID: 'nope', Fare: -5 }, true);
      return r.status === 400 && Array.isArray((r.body || {}).errors);
    })());
  ok('POST /api/buses duplicate Bus_ID -> 409',
    (await post('/api/buses', newBus, true)).status === 409);
  ok('PUT /api/buses/:busId -> 200',
    (await put('/api/buses/' + TEST_BUS, { Fare: 1600 }, true)).status === 200);
  ok('PATCH /api/buses/:busId/schedule -> 200',
    (await patch('/api/buses/' + TEST_BUS + '/schedule',
      { Travel_Date: today(4), Departure_Time: '09:00', Arrival_Time: '12:30' }, true)).status === 200);
  ok('PATCH schedule with arrival before departure -> 400',
    (await patch('/api/buses/' + TEST_BUS + '/schedule',
      { Travel_Date: today(4), Departure_Time: '12:00', Arrival_Time: '09:00' }, true)).status === 400);

  /* --------------------------- bookings ------------------------------ */
  section('BOOKINGS');
  const bookBus = TEST_BUS;
  const seatsBefore = ((await get('/api/buses/' + bookBus)).body.data || {}).Available_Seats;

  const bk = {
    Passenger_Name: 'Smoke Tester', Phone: '0771234567', Email: 'smoke@example.com',
    Bus_ID: bookBus, Seat_Number: 'A1', Boarding_Point: 'Colombo Fort'
  };
  const madeBooking = await post('/api/bookings', bk);
  const bookingId = (((madeBooking.body || {}).data) || {}).Booking_ID;
  ok('POST /api/bookings -> 201 (public, no token)',
    madeBooking.status === 201 && /^BK\d{8}\d{3}$/.test(String(bookingId)),
    'status=' + madeBooking.status + ' id=' + bookingId);

  const BK_FIELDS = ['Booking_ID', 'Passenger_Name', 'Phone', 'Email', 'Bus_ID', 'Travel_Date',
    'Seat_Number', 'Boarding_Point', 'Destination', 'Fare', 'Booking_Status'];
  const bkDoc = ((madeBooking.body || {}).data) || {};
  ok('booking carries every assignment field',
    BK_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(bkDoc, f)),
    'missing: ' + (BK_FIELDS.filter((f) => !(f in bkDoc)).join(',') || '-'));

  const seatsAfter = ((await get('/api/buses/' + bookBus)).body.data || {}).Available_Seats;
  ok('Available_Seats decremented by exactly 1',
    seatsAfter === seatsBefore - 1, seatsBefore + ' -> ' + seatsAfter);

  ok('double-booking the same seat -> 409',
    (await post('/api/bookings', bk)).status === 409);
  ok('POST /api/bookings invalid phone -> 400',
    (await post('/api/bookings', Object.assign({}, bk, { Phone: '123', Seat_Number: 'B2' }))).status === 400);
  ok('POST /api/bookings bad seat format -> 400',
    (await post('/api/bookings', Object.assign({}, bk, { Seat_Number: 'Z9' }))).status === 400);
  ok('POST /api/bookings unknown bus -> 404',
    (await post('/api/bookings', Object.assign({}, bk, { Bus_ID: 'MB000000', Seat_Number: 'B3' }))).status === 404);
  ok('fare/destination are taken from the bus, not the client',
    await (async () => {
      const r = await post('/api/bookings', Object.assign({}, bk, {
        Seat_Number: 'C3', Fare: 1, Destination: 'Hacked', Travel_Date: '1999-01-01'
      }));
      const d = (r.body || {}).data || {};
      if (r.status !== 201) { return false; }
      await patch('/api/bookings/' + d.Booking_ID + '/cancel');
      return d.Fare !== 1 && d.Destination !== 'Hacked' && d.Travel_Date !== '1999-01-01';
    })());

  ok('GET /api/bookings/:bookingId -> 200',
    (await get('/api/bookings/' + bookingId)).status === 200);
  ok('GET /api/bookings/passenger/:name partial + case-insensitive',
    await (async () => {
      const r = await get('/api/bookings/passenger/' + encodeURIComponent('smoke tes'));
      return r.status === 200 && (r.body.count || 0) > 0;
    })());
  ok('GET /api/bookings/phone/:phone -> 200',
    (await get('/api/bookings/phone/0771234567')).status === 200);
  ok('GET /api/bookings/email/:email -> 200',
    (await get('/api/bookings/email/' + encodeURIComponent('smoke@example.com'))).status === 200);
  ok('GET /api/bookings/bus/:busId -> 200',
    (await get('/api/bookings/bus/' + bookBus)).status === 200);
  ok('GET /api/bookings/date/:date -> 200',
    (await get('/api/bookings/date/' + today(4))).status === 200);
  ok('GET /api/bookings (all) requires admin',
    [401, 403].indexOf((await get('/api/bookings')).status) > -1);
  ok('GET /api/bookings with admin token -> 200',
    (await get('/api/bookings', true)).status === 200);

  ok('PUT /api/bookings/:bookingId edits allowed fields',
    (await put('/api/bookings/' + bookingId, { Passenger_Name: 'Smoke Tester II' })).status === 200);
  ok('PUT cannot change Fare (ignored or 400)',
    await (async () => {
      const r = await put('/api/bookings/' + bookingId, { Fare: 1 });
      if (r.status === 400) { return true; }
      const after = await get('/api/bookings/' + bookingId);
      return ((after.body || {}).data || {}).Fare !== 1;
    })());

  section('CANCELLATION');
  const beforeCancel = ((await get('/api/buses/' + bookBus)).body.data || {}).Available_Seats;
  const cancelled = await patch('/api/bookings/' + bookingId + '/cancel');
  ok('PATCH /api/bookings/:id/cancel -> 200 and status Cancelled',
    cancelled.status === 200 && (((cancelled.body || {}).data) || {}).Booking_Status === 'Cancelled',
    'status=' + cancelled.status);
  const afterCancel = ((await get('/api/buses/' + bookBus)).body.data || {}).Available_Seats;
  ok('cancelling frees the seat', afterCancel === beforeCancel + 1,
    beforeCancel + ' -> ' + afterCancel);
  ok('cancelling twice -> 409',
    (await patch('/api/bookings/' + bookingId + '/cancel')).status === 409);
  ok('a cancelled booking cannot be edited -> 409',
    (await put('/api/bookings/' + bookingId, { Passenger_Name: 'Nope' })).status === 409);
  ok('the freed seat can be booked again -> 201',
    await (async () => {
      const r = await post('/api/bookings', bk);
      if (r.status === 201) {
        await patch('/api/bookings/' + r.body.data.Booking_ID + '/cancel');
        return true;
      }
      return false;
    })());

  /* ---------------------------- routes ------------------------------- */
  section('ROUTES');
  const R = 'R9' + String(Date.now()).slice(-3);
  ok('GET /api/routes -> 200', (await get('/api/routes')).status === 200);
  ok('POST /api/routes without token -> 401/403',
    [401, 403].indexOf((await post('/api/routes', { Route_ID: R })).status) > -1);
  const rc = await post('/api/routes', {
    Route_ID: R, Route_Name: 'Smoke - Test', Departure: 'Smoke', Destination: 'Test',
    Distance_KM: 100, Duration_Min: 120, Base_Fare: 900, Stops: ['A', 'B']
  }, true);
  ok('POST /api/routes -> 201', rc.status === 201,
    'status=' + rc.status + ' ' + JSON.stringify(rc.body).slice(0, 120));
  ok('POST /api/routes invalid -> 400',
    (await post('/api/routes', { Route_ID: 'bad!' }, true)).status === 400);
  ok('GET /api/routes/:routeId -> 200', (await get('/api/routes/' + R)).status === 200);
  ok('PUT /api/routes/:routeId -> 200',
    (await put('/api/routes/' + R, { Base_Fare: 950 }, true)).status === 200);
  ok('DELETE /api/routes/:routeId -> 200',
    (await del('/api/routes/' + R, true)).status === 200);
  ok('GET deleted route -> 404', (await get('/api/routes/' + R)).status === 404);

  /* --------------------------- schedules ----------------------------- */
  section('SCHEDULES');
  const S = 'S9' + String(Date.now()).slice(-3);
  ok('GET /api/schedules -> 200', (await get('/api/schedules')).status === 200);
  const sc = await post('/api/schedules', {
    Schedule_ID: S, Bus_ID: TEST_BUS, Travel_Date: today(5),
    Departure_Time: '07:00', Arrival_Time: '10:00', Fare: 1700
  }, true);
  ok('POST /api/schedules -> 201', sc.status === 201,
    'status=' + sc.status + ' ' + JSON.stringify(sc.body).slice(0, 140));
  ok('creating a schedule syncs the linked bus',
    await (async () => {
      const b = (await get('/api/buses/' + TEST_BUS)).body.data || {};
      return b.Travel_Date === today(5) && b.Departure_Time === '07:00' && b.Fare === 1700;
    })(),
    JSON.stringify((await get('/api/buses/' + TEST_BUS)).body.data || {}).slice(0, 150));
  ok('GET /api/schedules?busId= filters',
    (await get('/api/schedules?busId=' + TEST_BUS)).status === 200);
  ok('GET /api/schedules/:scheduleId -> 200', (await get('/api/schedules/' + S)).status === 200);
  ok('PUT /api/schedules/:scheduleId -> 200',
    (await put('/api/schedules/' + S, { Fare: 1750 }, true)).status === 200);
  ok('POST /api/schedules unknown bus -> 404',
    (await post('/api/schedules', {
      Schedule_ID: 'S998', Bus_ID: 'MB000000', Travel_Date: today(5),
      Departure_Time: '07:00', Arrival_Time: '10:00', Fare: 100
    }, true)).status === 404);
  ok('DELETE /api/schedules/:scheduleId -> 200',
    (await del('/api/schedules/' + S, true)).status === 200);

  /* -------------------------- passengers ----------------------------- */
  section('PASSENGERS');
  ok('GET /api/passengers requires admin',
    [401, 403].indexOf((await get('/api/passengers')).status) > -1);
  const pl = await get('/api/passengers', true);
  ok('GET /api/passengers with token -> 200', pl.status === 200);
  const px = ((pl.body || {}).data || [])[0] || {};
  if (px.Passenger_ID) {
    const one = await get('/api/passengers/' + px.Passenger_ID, true);
    ok('GET /api/passengers/:id returns the passenger with bookings',
      one.status === 200 && Array.isArray(((one.body || {}).data || {}).Bookings),
      'keys=' + Object.keys(((one.body || {}).data) || {}).join(','));
  } else {
    ok('GET /api/passengers/:id returns the passenger with bookings', false, 'no passengers seeded');
  }
  const P = 'P9' + String(Date.now()).slice(-3);
  const pc = await post('/api/passengers', {
    Passenger_ID: P, Passenger_Name: 'Smoke Pax', Phone: '0719998887',
    Email: 'smokepax' + Date.now() + '@example.com', NIC: '2000' + String(Date.now()).slice(-8)
  }, true);
  ok('POST /api/passengers -> 201', pc.status === 201,
    'status=' + pc.status + ' ' + JSON.stringify(pc.body).slice(0, 120));
  // The service assigns its own running Passenger_ID (P0001, P0002, ...) and
  // ignores a supplied one, so follow-up calls must use what it returned.
  const newPaxId = (((pc.body || {}).data) || {}).Passenger_ID || P;
  ok('POST /api/passengers invalid email -> 400',
    (await post('/api/passengers', {
      Passenger_ID: P + 'x', Passenger_Name: 'X', Phone: '0711111111', Email: 'nope'
    }, true)).status === 400);
  ok('PUT /api/passengers/:id -> 200',
    (await put('/api/passengers/' + newPaxId, { Passenger_Name: 'Smoke Pax II' }, true)).status === 200);
  ok('DELETE /api/passengers/:id -> 200',
    (await del('/api/passengers/' + newPaxId, true)).status === 200);

  /* ------------------------- integrity ------------------------------- */
  section('INTEGRITY & CLEANUP');
  const bus = (await get('/api/buses/' + TEST_BUS)).body.data || {};
  const live = await post('/api/bookings', {
    Passenger_Name: 'Delete Guard', Phone: '0770000001', Email: 'guard@example.com',
    Bus_ID: TEST_BUS, Seat_Number: 'D4', Boarding_Point: 'Colombo Fort'
  });
  ok('DELETE a bus holding Confirmed bookings -> 409',
    (await del('/api/buses/' + TEST_BUS, true)).status === 409);
  if (live.status === 201) {
    await patch('/api/bookings/' + live.body.data.Booking_ID + '/cancel');
  }
  ok('DELETE the bus once nothing is Confirmed -> 200',
    (await del('/api/buses/' + TEST_BUS, true)).status === 200);
  ok('GET the deleted bus -> 404', (await get('/api/buses/' + TEST_BUS)).status === 404);

  section('ERROR HANDLING');
  ok('unknown /api path -> 404 JSON',
    await (async () => {
      const r = await get('/api/nope/nope');
      return r.status === 404 && r.body && r.body.success === false;
    })());
  ok('NoSQL operator in a query string is rejected or neutralised',
    await (async () => {
      const r = await get('/api/bookings/phone/' + encodeURIComponent('{"$ne":null}'));
      return r.status === 400 || (r.status === 200 && (r.body.count === 0));
    })());
  ok('no stack traces in error bodies',
    await (async () => {
      const r = await get('/api/buses/date/not-a-date');
      return !/at .*\(.*:\d+:\d+\)/.test(JSON.stringify(r.body));
    })());

  /* ------------------------------ done ------------------------------- */
  console.log('\n' + '='.repeat(52));
  console.log(fail === 0 ? 'ALL ' + pass + ' CHECKS PASSED' : pass + ' passed, ' + fail + ' FAILED');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSMOKE TEST CRASHED:', err && err.stack ? err.stack : err);
  process.exit(2);
});
