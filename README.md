# MetroFlow — Sri Lanka's Metro Bus Network 🚌

*More Than Just a Bus.* An **Online Metro Bus Booking System** built for **ETF Assignment 2**.

Passengers search routes, pick exact seats on a live seat map, book with instant Booking IDs, and manage trips.
Operators manage buses, schedules and bookings from a dashboard. A rule-based **Metro AI** assistant answers route, fare,
timing, seat and booking questions — all over a **Node.js + Express REST API** backed by **MongoDB**, with an
**HTML5 + Bootstrap 5 + jQuery (Ajax/JSON)** front end.

---

## Tech stack (assignment requirements)

| Layer | Used |
|---|---|
| Front end | HTML5 pages + **Bootstrap 5.3** + custom CSS (`public/css/style.css`) |
| Client scripting | **jQuery 3.7** — 7 distinct uses, labelled `// jQuery Use #n` (table below) |
| Ajax / data format | Every call goes through `public/js/api.js` (`$.ajax` / `$.getJSON`) with **JSON** in and out |
| Back end | **Node.js + Express 5** REST API, layered: routes → controllers → services → models |
| Database | **MongoDB** via **Mongoose 9** (`buses`, `bookings`, `users`, `counters`) |
| Extras | bcryptjs + JWT (auth), helmet (CSP), express-rate-limit, morgan, dotenv, cors |

jQuery, Bootstrap, Bootstrap Icons and the fonts are installed from npm and served locally (`/vendor/...`), so the site
works **offline** (e.g. during the VIVA). Only the destination photos (Unsplash) and the weather chip (Open-Meteo) need
internet, and both degrade gracefully.

---

## Prerequisites

- **Node.js 18+** (tested on Node 22)
- **MongoDB 6+** running locally (`mongodb://127.0.0.1:27017`) — tested with MongoDB 8.0 Community Server
  *(no MongoDB? see "Run without installing MongoDB" below)*

## Install & run

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run seed                # 24 buses, ~490 consistent bookings, 1 demo passenger
npm start                   # or: npm run dev   (auto-restart with nodemon)
```

Open **http://localhost:3000**

| Script | What it does |
|---|---|
| `npm start` | Start the server (uses `MONGO_URI`) |
| `npm run dev` | Same, with nodemon auto-reload (handy for the Task 2 live demo) |
| `npm run seed` | Wipe and re-seed the database |
| `npm run test:api` | Automated smoke test of all 21 graded endpoints + business rules (server must be running) |
| `npm run dev:mem` | Start with an **in-memory MongoDB**, auto-seeded (see below) |

### Run without installing MongoDB

`npm run dev:mem` starts an in-memory MongoDB via `mongodb-memory-server` and seeds it automatically. On the **first run it
downloads a MongoDB binary (~700 MB)**. If you already have a `mongod` binary, point to it to skip the download:
`MONGOMS_SYSTEM_BINARY=C:\path\to\mongod.exe npm run dev:mem`. Data is lost when the server stops.

## Environment (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/metroflow` | Database (database name **metroflow**) |
| `JWT_SECRET` | dev secret | Signs passenger/admin tokens — **change it** |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `metroflow123` | Operator dashboard login |
| `REQUIRE_ADMIN_AUTH` | `true` | Set `false` to call bus write-APIs without a token (quick Postman demos) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

## Pages & test logins

| URL | Page |
|---|---|
| `/` | Home — hero, *Plan Your Journey*, live popular route, routes grid, stats |
| `/search.html?from=Colombo&to=Kandy&date=&pax=2` | Search results with live sort/filter |
| `/seats.html?bus=MB1002&pax=2` | Seat selection (2 + 2 map) |
| `/booking.html` | Passenger details → confirmation e-ticket (printable) |
| `/my-trips.html` | Find / view / edit / cancel bookings (6 search modes) |
| `/admin.html` | Operator dashboard — **admin / metroflow123** |
| `/explore.html`, `/about.html` | Destinations, team, tech stack, contact |
| `/assistant.html` | Metro AI full page (also a floating widget on every page) |

Demo passenger account (optional — guests can book): **demo@metroflow.lk / demo1234**.
Sample booking from the brief: passenger **Kumara Silva**, phone **+94771001001** (search it in *My Trips*).

---

## Project structure

```
metroflow/
├─ server/
│  ├─ app.js            Express app: helmet CSP, cors, JSON, rate-limit, /api routes, static + /vendor, errors
│  ├─ server.js         Load .env → connect MongoDB → listen  (--memory flag = in-memory DB)
│  ├─ config/db.js
│  ├─ models/           Bus.js · Booking.js · User.js · Counter.js (Booking_ID sequences)
│  ├─ services/         busService.js · bookingService.js · chatService.js   ← all business rules
│  ├─ controllers/      busController.js · bookingController.js · chatController.js · statsController.js · authController.js
│  ├─ routes/           index.js · busRoutes.js · bookingRoutes.js
│  ├─ middleware/       validate.js · auth.js · errorHandler.js · asyncHandler.js
│  ├─ utils/            response.js · idGenerator.js · dates.js
│  └─ seed/seed.js
├─ public/              index · search · seats · booking · my-trips · admin · explore · about · assistant · 404 (.html)
│  ├─ partials/         navbar.html · footer.html · chat-widget.html  (loaded with jQuery .load())
│  ├─ css/              style.css (design system) · fonts.css
│  ├─ js/               api.js · main.js · home.js · search.js · seats.js · booking.js · trips.js · admin.js · chat.js · explore.js · about.js
│  └─ images/           logo, bus illustration, island map, placeholder (SVG)
├─ scripts/smoke-test.js
├─ docs/                API_Documentation.md · TASK2_Add_New_Service_Guide.md · MetroFlow.postman_collection.json
├─ .env.example · package.json · README.md
```

---

## REST API summary

Full details with request/response samples: **[docs/API_Documentation.md](docs/API_Documentation.md)** ·
Postman: import **[docs/MetroFlow.postman_collection.json](docs/MetroFlow.postman_collection.json)** and run *Auth → Admin login* first.

| # | Bus service | Endpoint | | # | Booking service | Endpoint |
|---|---|---|---|---|---|---|
| 1 | Insert bus 🔒 | `POST /api/buses` | | 1 | Insert booking | `POST /api/bookings` |
| 2 | All buses | `GET /api/buses` | | 2 | All bookings | `GET /api/bookings` |
| 3 | By Bus ID | `GET /api/buses/:busId` | | 3 | By Booking ID | `GET /api/bookings/:bookingId` |
| 4 | By route | `GET /api/buses/route/:route` | | 4 | By passenger name | `GET /api/bookings/passenger/:name` |
| 5 | By departure | `GET /api/buses/departure/:departure` | | 5 | By phone | `GET /api/bookings/phone/:phone` |
| 6 | By destination | `GET /api/buses/destination/:destination` | | 6 | By email | `GET /api/bookings/email/:email` |
| 7 | By travel date | `GET /api/buses/date/:date` | | 7 | By Bus ID | `GET /api/bookings/bus/:busId` |
| 8 | Available buses | `GET /api/buses/available?from=&to=&date=&minSeats=` | | 8 | By travel date | `GET /api/bookings/date/:date` |
| 9 | Update details 🔒 | `PUT /api/buses/:busId` | | 9 | Update booking | `PUT /api/bookings/:bookingId` |
| 10 | Update schedule 🔒 | `PATCH /api/buses/:busId/schedule` | | 10 | Cancel booking | `PATCH /api/bookings/:bookingId/cancel` |
| 11 | Delete bus 🔒 | `DELETE /api/buses/:busId` | | | | |

🔒 = operator token required (`POST /api/auth/admin/login`). Helpers: `/api/buses/:busId/seats`, `/api/buses/popular`,
`/api/buses/locations`, `/api/stats`, `/api/chat`, `/api/auth/*`, `/api/health`.

### Key business rules
- **No double booking** — a partial unique index on `(Bus_ID, Travel_Date, Seat_Number)` for *Confirmed* bookings, plus an
  atomic conditional `$inc` on `Available_Seats`. Tested with 10 simultaneous requests for one seat → exactly one `201`, nine `409`.
- **Fare, Destination and Travel_Date are copied from the bus**; the client's values are never trusted.
- **Cancel** only Confirmed bookings (second cancel → `409`); the seat and `Available_Seats` are restored.
- **Deleting a bus with Confirmed bookings is blocked (`409`)** — cancel them first (chosen over silent cascade).
- `Available_Seats` is system-managed: on update it is recalculated as `Total_Seats − confirmed bookings`.
- `Booking_ID = BK<YYYYMMDD><NNN>` — travel date + atomic per-date counter (e.g. first booking for 15 Oct 2026 → `BK20261015001`).
- Validation on **both** sides: name, Sri Lankan phone (`+94XXXXXXXXX` / `07XXXXXXXX`), email, dates not in the past, seat `A1–M4`, times `HH:mm`, arrival after departure.

---

## jQuery — distinct uses

| # | Use | Where (file:line) |
|---|---|---|
| 1 | **DOM events & selection** — swap From ⇄ To; seat clicks via event delegation | [main.js:206](public/js/main.js#L206), [seats.js:77](public/js/seats.js#L77) |
| 2 | **Ajax** — `$.ajax` JSON wrapper for every call; `$.getJSON`; parallel loads with `$.when` | [api.js:19](public/js/api.js#L19), [api.js:50](public/js/api.js#L50), [seats.js:21](public/js/seats.js#L21), [search.js:73](public/js/search.js#L73) |
| 3 | **Dynamic DOM building** — bus cards, seat grid, booking cards, admin tables, chat bubbles | [search.js:23](public/js/search.js#L23), [seats.js:51](public/js/seats.js#L51), [trips.js:55](public/js/trips.js#L55), [admin.js:69](public/js/admin.js#L69), [chat.js:13](public/js/chat.js#L13) |
| 4 | **Form serialisation & validation** — `.serializeArray()` → JSON; live `.addClass/.removeClass` feedback | [main.js:120](public/js/main.js#L120), [main.js:127](public/js/main.js#L127), [booking.js:45](public/js/booking.js#L45) |
| 5 | **Animations & effects** — toasts `fadeIn/fadeOut`, `slideToggle` filters, `.animate()` counters & scrolling | [main.js:26](public/js/main.js#L26), [main.js:234](public/js/main.js#L234), [main.js:252](public/js/main.js#L252), [search.js:149](public/js/search.js#L149), [booking.js:129](public/js/booking.js#L129) |
| 6 | **Live filtering / sorting without reload** — `.filter()`, `.toggle()`, sort + re-append | [search.js:102](public/js/search.js#L102), [admin.js:93](public/js/admin.js#L93), [explore.js:46](public/js/explore.js#L46) |
| 7 | **Partials, autocomplete, ready** — `.load()` navbar/footer/chat, keyboard autocomplete, `$(document).ready` | [main.js:38](public/js/main.js#L38), [main.js:155](public/js/main.js#L155), [main.js:275](public/js/main.js#L275) |

---

## Metro AI assistant

Rule-based, no paid API (`server/services/chatService.js`): extracts places (from the live DB), dates (*today, tomorrow,
weekday, YYYY-MM-DD*) and Booking IDs, detects intent (*route search, cheapest, price, timing, seats, booking status,
cancellation help, popular routes*), queries the services and replies with up to 4 bookable bus cards + quick-reply chips.
**LLM hook:** set `require('./server/services/chatService').llm = async (message) => 'reply'` at startup to let a real
model answer anything the rules don't understand.

## Future-ready backend (designed, not implemented)

`bookingService.hooks` (`server/services/bookingService.js`) is the extension point:

- **Online payments** — `hooks.afterCreate`: create a payment intent and keep status *Pending* until paid; `afterCancel`: refund.
- **SMS / Email notifications** — `afterCreate` / `afterCancel`: call a `NotificationService` (e.g. Twilio / Dialog SMS, SMTP).
- **Digital tickets (PDF / QR)** — `afterCreate`: generate the e-ticket and store its URL on the booking.

Because controllers only call services, these plug in without touching routes or the front end.

## Security & quality

Helmet CSP (scripts only from self), rate limiting on `/api`, JSON body limit, `$`-key stripping (NoSQL-injection guard),
regex-escaping for search input, HTML-escaping of all API data rendered on the client (`MF.esc`), bcrypt-hashed passwords,
JWT auth, central error handler, Mongoose validators as a second validation layer. Accessibility: semantic landmarks,
skip link, labelled controls, ARIA on the seat map/chat/modals, visible focus rings, `prefers-reduced-motion` support.

## Adding a new service (Task 2)

See **[docs/TASK2_Add_New_Service_Guide.md](docs/TASK2_Add_New_Service_Guide.md)** — an 8-step walkthrough (model → service →
controller → route → curl/Postman → `api.js` → jQuery UI → end-to-end test) using a new *Find Buses by Fare Range* service.

## Assumptions & decisions

- One bus document = one scheduled trip (it has a single `Travel_Date`); a bus's bookings follow it if it is rescheduled.
- Seed trips start on **2026-10-15 or today, whichever is later**, so the demo always has bookable future trips.
- Trips are same-day (arrival must be after departure); overnight services are modelled as daytime runs.
- One booking per seat; multi-seat purchases create several bookings that share passenger details.
