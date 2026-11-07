# Member 4 – Booking Management & Booking Search

## My files
| File | What it does |
|---|---|
| server/models/Booking.js | Booking schema (brief's field names) + "no double booking" index |
| server/models/Counter.js | Running number per date for Booking IDs |
| server/utils/idGenerator.js | Generate booking ID: BK + YYYYMMDD + 001 |
| server/services/bookingService.js | All booking rules: create, view, search, update, cancel |
| server/controllers/bookingController.js | HTTP -> service calls, same JSON shape as the bus API |
| server/routes/bookingRoutes.js | The 10 /api/bookings endpoints (+ booked-seats helper) |
| public/booking.html + js/booking.js | Passenger details -> create booking(s) -> e-ticket |
| public/my-trips.html + js/trips.js | Booking search (6 modes), view, update, cancel |
| public/css/booking.css | Styles for my two pages (`bk-` prefix, uses the shared tokens) |

## Endpoints (all return `{ success, message?, count?, data }` or `{ success: false, error, details? }`)
| # | Service | Endpoint |
|---|---|---|
| 1 | Insert booking | POST /api/bookings |
| 2 | All bookings | GET /api/bookings |
| 3 | By Booking ID | GET /api/bookings/:bookingId |
| 4 | By passenger name | GET /api/bookings/passenger/:name |
| 5 | By phone | GET /api/bookings/phone/:phone |
| 6 | By email | GET /api/bookings/email/:email |
| 7 | By Bus ID | GET /api/bookings/bus/:busId |
| 8 | By travel date | GET /api/bookings/date/:date |
| 9 | Update booking | PUT /api/bookings/:bookingId |
| 10 | Cancel booking | PATCH /api/bookings/:bookingId/cancel |
| helper | Booked seats on a bus (for the seat map) | GET /api/bookings/bus/:busId/seats |

## How a booking links passenger + bus + schedule + seat
1. Check passenger details (name, Sri Lankan phone, email, seat A1–M4).
2. Find the bus (404 if missing; 409 if Unavailable or already departed; 400 if the seat isn't on it).
3. Check the seat is free on that trip (409 if taken).
4. Reserve the seat: `Available_Seats - 1`, only if it is > 0 (atomic).
5. Copy Travel_Date, Destination and Fare **from the bus** (never trust the client).
6. Generate the Booking ID and save. If saving fails, the seat is given back.

Cancel = status becomes "Cancelled" (record kept), `Available_Seats + 1`, seat can be rebooked.
Deleting a bus with Confirmed bookings is already blocked in busService.deleteBus.

## What still needs a teammate (not booking files)
- **server/routes/busRoutes.js** contains a copy of Bus.js – it must define the bus routes.
- **server/app.js, server/server.js, server/config/db.js, server/routes/index.js** are empty –
  `routes/index.js` needs `router.use('/bookings', require('./bookingRoutes'))`.
- **seats.html** – after picking seats, go to `booking.html?bus=MB1002&seats=A1,A2`.
  Booked seats: `GET /api/bookings/bus/:busId/seats`.

## Extra features (to stand out)
All in `public/js/booking-extras.js` – front-end only, built from data the API already returns.
| Feature | Where | How it works |
|---|---|---|
| Scannable barcode + Download ticket (PDF) | booking.html | JsBarcode (Code 128 of the Booking ID); html2canvas + jsPDF, one ticket per page |
| Scratch-card reward | booking.html, after booking | Canvas "foil" erased with the mouse/finger; reward chosen from the Booking ID so it never changes |
| Live departure countdown | e-ticket + My Trips cards | Ticks every second, turns red within 24 h |
| Carbon saved | e-ticket, My Trips | Distance ≈ journey time × 40 km/h; saving = km × (0.17 − 0.03) kg CO₂ |
| MetroMiles loyalty | My Trips (results for one passenger) | 1 mile per LKR 10 confirmed; Bronze → Silver (500) → Gold (1500) → Platinum (3000) |
| Share to WhatsApp | e-ticket + My Trips cards | wa.me link with the trip details and Booking ID |

## Animations
| Where | What | How |
|---|---|---|
| Trip summary | Bus drives along a dashed route | CSS @keyframes (bk-drive) |
| Total price, MetroMiles | Number counts up | jQuery `.animate()` step function (countUp) |
| Invalid form field | Shake | CSS @keyframes (bk-shake) |
| Booking confirmed | Tick draws itself, confetti burst, tickets "print" out | SVG stroke-dashoffset, canvas + requestAnimationFrame, CSS clip-path |
| My Trips cards | Rise in one after another | CSS animation with staggered animation-delay |
| Cancel booking | Ticket rips in half along its dashed line | two clipped clones (zig-zag clip-path) that fall apart |
All animations are switched off when the user's system has "reduce motion" turned on.

## Fix
A bus that already left today can no longer be booked: the server compares Departure_Time with the current
time (409 "This bus has already departed"), and the booking page disables Confirm with a message.
