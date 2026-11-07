// bookingRoutes.js – defines /api/bookings endpoints
const express = require('express');
const c = require('../controllers/bookingController');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Search routes come BEFORE "/:bookingId", otherwise Express would treat
// "passenger", "phone", ... as a booking ID.
router.get('/passenger/:name', c.getByPassengerName); // 4
router.get('/phone/:phone', c.getByPhone);            // 5
router.get('/email/:email', c.getByEmail);            // 6
router.get('/bus/:busId/seats', c.getBookedSeats);    // helper for the seat map
router.get('/bus/:busId', c.getByBusId);              // 7
router.get('/date/:date', c.getByTravelDate);         // 8

router.post('/', c.createBooking);                    // 1
// Admin only: the full list exposes every passenger's phone and email.
// Single-booking and search-by-reference lookups below stay public so the
// My Trips page keeps working without a login.
router.get('/', protect, adminOnly, c.getAllBookings);  // 2
router.get('/:bookingId', c.getBookingById);          // 3
router.put('/:bookingId', c.updateBooking);           // 9
router.patch('/:bookingId/cancel', c.cancelBooking);  // 10

module.exports = router;
