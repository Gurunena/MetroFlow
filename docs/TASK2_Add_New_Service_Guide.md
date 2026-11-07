# Adding a new service to MetroFlow — the real steps

This is the walk-through to demo at the viva. It follows the layering the
codebase actually uses:

```
routes/  →  controllers/  →  services/  →  models/
  (URL)       (thin)          (logic)      (Mongoose)
```

A controller never touches the database, and a service never touches `req`
or `res`. That is what makes each layer testable on its own.

Two worked examples follow. **Example A** is already built and is the one to
demo; **Example B** is the exercise.

---

# Example A — "Bus search by route and date" (already in the code)

Trace it end to end in the editor; every file is real.

### 1. Model — `server/models/Bus.js`

The fields exist and are indexed for exactly this query:

```js
busSchema.index({ Departure: 1, Destination: 1, Travel_Date: 1 });
```

Without that compound index MongoDB scans every bus. With it, the search is
a direct index lookup.

### 2. Service — `server/services/busService.js`

The logic, and nothing else:

```js
const ci = (v) => new RegExp('^' + escapeRegex(String(v).trim()) + '$', 'i');

function findAvailable({ from, to, date, minSeats } = {}) {
  const q = { Available_Seats: { $gt: 0 } };
  if (from) q.Departure = ci(from);
  if (to) q.Destination = ci(to);
  if (date) q.Travel_Date = date;
  if (minSeats) q.Available_Seats = { $gte: Number(minSeats) };
  return Bus.find(q).sort(SORT).lean();
}
```

Note `escapeRegex`. A visitor typing `.*` must match the literal text, not
every row — and a pattern like `(a+)+` must not be able to hang the server.

### 3. Controller — `server/controllers/busController.js`

One line. It unwraps the request and hands the result to the envelope:

```js
available: handler((req) => busService.findAvailable(req.query)),
```

`handler()` wraps the result as `{ success, count, data }` and turns a thrown
`ApiError` into the right status code.

### 4. Route — `server/routes/busRoutes.js`

```js
router.get('/available', c.available);          // BEFORE '/:busId'
```

**Order matters.** If `/:busId` were declared first, Express would read
"available" as a Bus_ID and the search would 404.

### 5. Test — `server/tests/api-smoke.js`

```js
ok('GET /api/buses/available?from=&to=&date= -> 200',
  (await get('/api/buses/available?from=Colombo&to=Kandy&date=' + d)).status === 200);
ok('regex metacharacters in a path param do not match everything',
  inj.status === 200 && inj.body.count < all.body.count);
```

Run it with `npm run smoke`.

### 6. Ajax — `public/js/search.js`

```js
$.ajax({ url: '/api/buses/available', data: { from, to, date }, dataType: 'json' })
  .done(function (res) { render(res.data); })
  .fail(function (xhr) { showError(friendlyError(xhr)); });
```

### 7. UI — `public/search.html`

The results list, the filters, and a plain-text error region the `.fail()`
branch writes into.

---

# Example B — "Booking cancellation" (the other demo path)

The most interesting one, because it has to stay correct under a race.

### 1. Model

The seat lock lives in `server/models/Booking.js`:

```js
bookingSchema.index(
  { Bus_ID: 1, Travel_Date: 1, Seat_Number: 1 },
  { unique: true, partialFilterExpression: { Booking_Status: 'Confirmed' } }
);
```

`partialFilterExpression` is the whole trick. Only **Confirmed** rows are in
the index, so:

* two people cannot hold the same seat — the second insert is a duplicate key;
* a **Cancelled** booking leaves the index, so the seat is immediately sellable
  again while the cancelled row survives as history.

### 2. Service — `server/services/bookingService.js`

```js
async function cancelBooking(bookingId) {
  // One atomic step: flip the status only if it is still Confirmed. Two
  // simultaneous cancels cannot both match, so the seat is returned once.
  const booking = await Booking.findOneAndUpdate(
    { Booking_ID: id, Booking_Status: 'Confirmed' },
    { $set: { Booking_Status: 'Cancelled' } },
    { returnDocument: 'after' }
  );

  if (!booking) {
    if (await Booking.exists({ Booking_ID: id })) {
      throw new ServiceError(409, 'Booking ' + id + ' is already cancelled');
    }
    throw new ServiceError(404, 'Booking not found');
  }

  // Give the seat back, but never above the coach's capacity.
  await Bus.updateOne(
    { Bus_ID: booking.Bus_ID, $expr: { $lt: ['$Available_Seats', '$Total_Seats'] } },
    { $inc: { Available_Seats: 1 } }
  );
  return booking.toJSON();
}
```

Two guards are doing the work. The filter `Booking_Status: 'Confirmed'` in the
`findOneAndUpdate` means a double-cancel cannot return the seat twice, and the
`$expr` caps the increment at the coach's capacity.

The matching **create** path is the mirror image — the decrement is atomic,
so two simultaneous bookings cannot both take the last seat:

```js
const claimed = await Bus.findOneAndUpdate(
  { Bus_ID: busId, Available_Seats: { $gt: 0 } },
  { $inc: { Available_Seats: -1 } },
  { new: true }
);
if (!claimed) throw new ServiceError(409, 'No seats left on ' + busId);
// …and if the booking then fails to save, the counter is rolled back.
```

### 3. Controller

```js
cancelBooking: handler((req) => bookingService.cancelBooking(req.params.bookingId),
                       { message: 'Booking cancelled' }),
```

### 4. Route — `server/routes/bookingRoutes.js`

```js
router.patch('/:bookingId/cancel', c.cancelBooking);
```

`PATCH`, not `DELETE`: the row is kept and its status changes.

### 5. Test

```js
ok('cancelling frees the seat', afterCancel === beforeCancel + 1);
ok('cancelling twice -> 409',
  (await patch('/api/bookings/' + id + '/cancel')).status === 409);
ok('the freed seat can be booked again -> 201', …);
```

### 6. Ajax — `public/js/trips.js`

```js
$.ajax({ url: '/api/bookings/' + id + '/cancel', method: 'PATCH' })
  .done(reloadTrips)
  .fail(function (xhr) { showError(xhr.responseJSON.message); });
```

### 7. UI — `public/my-trips.html`

A Cancel button, a confirmation step, and the seat count visibly going up.

---

# Checklist for any new service

1. **Model** — fields, validators, and the index the query will use.
2. **Service** — the logic. Throw `new ApiError(status, message)`; escape any
   user input that goes into a `RegExp`.
3. **Controller** — one line through `handler()`. No database calls here.
4. **Route** — static paths before `/:param`. Add `protect, adminOnly` if it
   writes. Add the matching validator from `middleware/validate.js`.
5. **Validator** — a rules object in `middleware/validate.js` so bad input is
   rejected with `400` and a per-field `errors[]`.
6. **Test** — one valid case and one invalid case in
   `server/tests/api-smoke.js`, then `npm run smoke`.
7. **Ajax** — call it from `public/js/…`, and handle `.fail()` with a message
   a passenger can act on.
8. **UI** — render the result, and show the error where the user is looking.
9. **Docs** — add the endpoint to `docs/API_Documentation.md` and a request to
   `docs/MetroFlow.postman_collection.json`.

## Commands

```bash
npm start                  # run the server
npm run seed               # upsert the sample data (idempotent)
npm run migrate            # back-fill references on an existing database
npm run smoke              # every endpoint, valid and invalid input
node server/tests/db-report.js   # collections, sample docs, indexes, consistency
```
