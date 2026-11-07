# MetroFlow — REST API

Base URL `http://localhost:3000/api`. Everything speaks JSON.

## Response envelope

Success:

```json
{ "success": true, "count": 15, "data": [ ... ] }
```

`count` appears only when `data` is a list. Some write endpoints add
`"message": "Bus added successfully"`.

Failure:

```json
{ "success": false, "message": "Validation failed",
  "errors": [{ "field": "Phone", "message": "Phone must look like 0771234567 or +94771234567" }] }
```

| Code | When |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Validation failed — `errors[]` names each bad field |
| 401 | No token, or the token is invalid/expired |
| 403 | Signed in, but not an administrator |
| 404 | No such row, or no such endpoint |
| 409 | Conflict — duplicate key, seat taken, already cancelled, still referenced |
| 413 | Body over 100 kB |
| 503 | MongoDB unreachable |
| 500 | Genuine server fault. Never contains a stack trace. |

## Authentication

```
POST /api/auth/admin-login     { "Email": "admin@metroflow.lk", "Password": "admin123" }
→ 200 { "success": true, "data": { "token": "eyJ…", "user": { "Role": "admin", … } } }
```

Send it on protected calls as `Authorization: Bearer <token>`. Admin tokens
last 2 hours, passenger tokens 7 days.

### Which routes need a token

**Admin only** (`protect` + `adminOnly`):

* `POST` / `PUT` / `PATCH` / `DELETE` on `/api/buses`
* `POST` / `PUT` / `DELETE` on `/api/routes` and `/api/schedules`
* every `/api/passengers` route
* `GET /api/stats`
* `GET` and `PATCH` on `/api/contact`

**Signed-in, any role** — `GET /api/bookings`. An operator gets every
booking; a passenger gets only their own, matched on the email in their
token. A guest is refused with `401`, because the unscoped list holds every
passenger's name, phone and email. This is what My Trips' "Show all" button
calls; its six search modes below need no login.

**Public** — deliberately, so the passenger pages work without signing in:
all bus search `GET`s, `GET /api/buses/:busId/seats`, `POST /api/bookings`,
every single-booking lookup used by My Trips (`/:bookingId`, `/phone/…`,
`/email/…`, `/passenger/…`, `/bus/…`, `/date/…`), `PUT`/`PATCH` on one
booking, `GET` on `/api/routes`, `/api/schedules` and `/api/destinations`,
`POST /api/contact`, and `/api/health`.

---

# 1. Metro Bus services

### 1. `POST /api/buses` — insert a bus · admin

```json
{
  "Bus_ID": "MB1025", "Bus_Name": "Metro Express", "Route": "Colombo - Kandy",
  "Departure": "Colombo", "Destination": "Kandy", "Travel_Date": "2026-11-20",
  "Departure_Time": "06:30", "Arrival_Time": "09:45",
  "Total_Seats": 48, "Available_Seats": 48, "Fare": 1850
}
```

`201` → `{ "success": true, "message": "Bus added successfully", "data": { … } }`
· `400` invalid · `401/403` no admin · `409` `Bus_ID` exists

### 2. `GET /api/buses` — all buses

Optional `?from=&to=&date=&upcoming=true`.
`200` → `{ "success": true, "count": 15, "data": [ … ] }`

### 3. `GET /api/buses/:busId`
`200` the bus · `404` unknown

### 4. `GET /api/buses/route/:route`
e.g. `/api/buses/route/Colombo%20-%20Kandy`. Case-insensitive exact match.

### 5. `GET /api/buses/departure/:departure`
### 6. `GET /api/buses/destination/:destination`

### 7. `GET /api/buses/date/:date`
`/api/buses/date/2026-11-20` · `400` if the date is not a real `YYYY-MM-DD`

### 8. `GET /api/buses/available`
`?from=Colombo&to=Kandy&date=2026-11-20&minSeats=2` — only services with
seats left.

### 9. `PUT /api/buses/:busId` — update · admin
Any subset of the bus fields; `Bus_ID` is immutable. `Available_Seats` is
recalculated as `Total_Seats − confirmed` whenever bookings exist.
`409` if `Total_Seats` would drop below the number already sold.

### 10. `PATCH /api/buses/:busId/schedule` — reschedule · admin

```json
{ "Travel_Date": "2026-11-22", "Departure_Time": "07:00", "Arrival_Time": "10:15" }
```

Existing bookings move with the bus. `400` if arrival ≤ departure.

### 11. `DELETE /api/buses/:busId` — admin
`409` while the bus holds confirmed bookings.

### Helper · `GET /api/buses/:busId/seats?date=`

```json
{ "success": true, "data": {
  "Bus_ID": "MB1001", "Travel_Date": "2026-11-07", "total": 48,
  "seats": ["A1","A2", "…"], "booked": ["A1","B3"], "available": 42, "fare": 1850 } }
```

### Helper · `GET /api/buses/locations`
Distinct departure and destination names, for the autocomplete.

---

# 2. Passenger / Booking services

### 1. `POST /api/bookings` — create · public

```json
{
  "Passenger_Name": "Nimal Perera", "Phone": "0771234567",
  "Email": "nimal.perera@example.com", "Bus_ID": "MB1001",
  "Seat_Number": "A1", "Boarding_Point": "Colombo Fort"
}
```

`Travel_Date`, `Destination` and `Fare` are taken from the bus — sending them
is accepted but ignored.

`201` → the booking with its `Booking_ID` · `400` invalid · `404` no such bus
· `409` seat already booked / bus full

### 2. `GET /api/bookings` — **signed in**

Admin → every booking. Passenger → only their own. Guest → `401`.
### 3. `GET /api/bookings/:bookingId`
### 4. `GET /api/bookings/passenger/:name` — case-insensitive, partial
### 5. `GET /api/bookings/phone/:phone`
### 6. `GET /api/bookings/email/:email`
### 7. `GET /api/bookings/bus/:busId`
### 8. `GET /api/bookings/date/:date`

### 9. `PUT /api/bookings/:bookingId` — edit

Only `Passenger_Name`, `Phone`, `Email`, `Seat_Number`, `Boarding_Point`.
A seat change re-checks availability. `409` if the booking is cancelled.

### 10. `PATCH /api/bookings/:bookingId/cancel`

`200` with `Booking_Status: "Cancelled"`, and the seat is returned to the bus.
`409` if it was already cancelled.

---

# 3. Routes

| Method | URL | Access |
|---|---|---|
| `GET` | `/api/routes` `?status=&from=&to=&search=` | public |
| `GET` | `/api/routes/:routeId` | public |
| `POST` | `/api/routes` | admin |
| `PUT` | `/api/routes/:routeId` | admin |
| `DELETE` | `/api/routes/:routeId` | admin |

```json
{
  "Route_ID": "R009", "Route_Name": "Colombo - Negombo",
  "Departure": "Colombo", "Destination": "Negombo",
  "Distance_KM": 38, "Duration_Min": 75, "Base_Fare": 480,
  "Stops": ["Ja-Ela", "Seeduwa"]
}
```

`409` on a duplicate `Route_ID` or a second route for the same city pair, and
on `DELETE` while buses or schedules still reference it.

---

# 4. Schedules

| Method | URL | Access |
|---|---|---|
| `GET` | `/api/schedules` `?busId=&date=&routeId=&status=` | public |
| `GET` | `/api/schedules/:scheduleId` | public |
| `POST` | `/api/schedules` | admin |
| `PUT` | `/api/schedules/:scheduleId` | admin |
| `DELETE` | `/api/schedules/:scheduleId` | admin |

```json
{
  "Schedule_ID": "S016", "Bus_ID": "MB1001", "Travel_Date": "2026-11-25",
  "Departure_Time": "07:00", "Arrival_Time": "10:15", "Fare": 1900
}
```

Creating or updating a schedule **writes the date, times and fare through to
the linked bus**. `404` if the bus or route is unknown; `409` if that bus
already has a schedule at that time on that date.

---

# 5. Passengers · all admin

| Method | URL |
|---|---|
| `GET` | `/api/passengers` `?search=` |
| `GET` | `/api/passengers/:passengerId` — includes a `Bookings` array |
| `POST` | `/api/passengers` |
| `PUT` | `/api/passengers/:passengerId` |
| `DELETE` | `/api/passengers/:passengerId` |

`Passenger_ID` is assigned by the server (`P0001`, `P0002`, …); a supplied one
is ignored. `Passenger_Name` and `Full_Name` are interchangeable.
`DELETE` → `409` while the passenger holds confirmed bookings.

---

# 6. Helpers

### `GET /api/health` — public

```json
{ "success": true, "status": "ok", "db": "connected",
  "data": { "api": "up", "status": "ok", "database": "connected" } }
```

### `GET /api/stats` — admin

```json
{ "success": true, "data": {
  "totalBuses": 15, "totalBookings": 84, "todaysBookings": 6,
  "seatsSold": 78, "revenue": 139420 } }
```

Derived from the collections on every call, so it can never drift.

### `GET /api/destinations` — public
Explore-page destinations; `/:slug` and `/:slug/buses` also exist.

### `POST /api/contact` — public; `GET` and `PATCH /api/contact/:messageId` — admin

---

# 7. Security notes

* Every request passes through a sanitiser that strips keys beginning with
  `$` or containing `.`, so `{"$ne": null}` can never reach a query as an
  operator.
* Every value interpolated into a `RegExp` is escaped first, so `.*` in a
  path parameter matches the literal text and cannot cause a ReDoS.
* Unknown fields in a request body are rejected with `400`.
* Bodies are capped at 100 kB.
* Passwords are bcrypt-hashed and the hash is `select: false`.
* Error responses never contain a stack trace.

# 8. Not implemented

`POST /api/chat` — the `chatRoutes.js` / `chatController.js` / `chatService.js`
trio are still empty stubs, so `/api/chat` is not mounted. Nothing calls it:
the Metro AI assistant runs client-side in `public/js/chat.js` and reads live
data from `/api/buses`.
