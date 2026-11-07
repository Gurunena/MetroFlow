# Member 3 – Seat Management & Passenger Management

## Files
| File | What it does |
|---|---|
| server/models/Passenger.js | Passenger schema: Passenger_ID, Full_Name, NIC, Phone, Email, Address, Gender (MongoDB) |
| server/services/passengerService.js | Rules: validation, unique NIC, Passenger_ID (P0001, P0002 …), add / list / search / view / update / delete |
| server/controllers/passengerController.js | HTTP → service, same JSON shape as the bus & booking APIs |
| server/routes/passengerRoutes.js | The /api/passengers endpoints – admin only (checks the admin login token) |
| server/routes/index.js | One line added: `mount('/passengers', './passengerRoutes', 'passengers');` |
| public/passenger-details.html + js/passenger-details.js | Passenger Management page (admin) – jQuery Ajax to /api/passengers |
| public/admin.html | One tab added: **Passengers** → passenger-details.html |
| public/css/manage-bookings.css | Light page header added at the end, to match Explore / My Trips |
| public/manage-bookings.html + js/manage-bookings.js | Seat Management page – real seat map from the server |
| public/seats.html | Forwards the Search page's "Select Seats" links to manage-bookings.html |

## Passenger Management is admin-only
Passenger records hold personal data (NIC, phone, email), and the brief says administrators
manage passengers. So:
- the page is opened from the **admin dashboard → Passengers** tab; anyone not logged in as admin is sent to admin-login.html
- every /api/passengers request must carry the admin's login token (`Authorization: Bearer …`, sent automatically by auth.js);
  no token → 401, a non-admin token → 403
- the public seat page no longer links to it

## Passenger REST API (MongoDB)
| # | Service | Endpoint |
|---|---|---|
| 1 | Add passenger | POST /api/passengers |
| 2 | View all passengers (+ search) | GET /api/passengers  ·  GET /api/passengers?search=nimal |
| 3 | View passenger details | GET /api/passengers/:passengerId |
| 4 | Update passenger | PUT /api/passengers/:passengerId |
| 5 | Delete passenger | DELETE /api/passengers/:passengerId |

Validation (client + server): name 2–60 chars, NIC = 9 digits + V/X, 12 digits, or passport (N1234567),
phone +94XXXXXXXXX / 07XXXXXXXX, valid email, NIC must be unique (409 if already registered).

## Seat Management (uses existing APIs)
| Requirement | How |
|---|---|
| Display seat layout | Seats A1, A2 … built from the bus's Total_Seats (GET /api/buses/:busId), 4 per row |
| Show available / occupied seats | Booked seats from GET /api/bookings/bus/:busId/seats are grey and disabled |
| Select seats | **Passengers** select (1–6, starts from the Search page's count). Exactly that many seats must be chosen before Continue is enabled; lowering the count removes the extra seats. Total price shown. |
| Update seat availability | A booking takes a seat and a cancellation frees it (booking API updates Available_Seats). The page re-checks every 20 s and on "Refresh Seat Availability"; a seat someone else just booked is removed from your selection. |
| Continue | "Continue to booking" → booking.html?bus=MB1002&seats=A1,A2 (Member 4) |

Flow: Search → **Select Seats** → seats.html → manage-bookings.html?busId=…&pax=… → Continue → booking.html
(The seat page is not in the navbar – it is always reached from a search result. Opened without a bus, it shows a "Find a bus" button.)

## jQuery uses on these pages
Events & delegation (`.on('click', '.seat…')`), Ajax (`$.ajax` GET/POST/PUT/DELETE), DOM building
(`.append`, `.html`, `.empty`), effects (`.fadeIn`, `.fadeOut`, `.slideDown`, `.animate`),
form handling (`.val`, `.addClass('is-invalid')`), `$.each` / `$.grep` / `$.map`.

## Look & feel (matches the rest of MetroFlow)
- Passenger page uses the **operator dashboard** layout: same header, same pill tabs (Passengers active),
  white panels, light table, icon buttons, Bootstrap modal for "View" (admin.css – no separate CSS needed)
- Seat page: light header like Explore / My Trips, MetroFlow fonts, favicon, chat widget, navbar login state (auth.js)
- passenger-details.css is no longer used by the page
