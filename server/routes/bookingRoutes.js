// bookingRoutes.js – defines /api/bookings endpoints
const express = require('express');
const c = require('../controllers/bookingController');
const { protect } = require('../middleware/auth');

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
// Signed-in only. An operator gets every booking; a passenger gets their
// own (see bookingController.getAllBookings). A guest is refused, because
// the unscoped list exposes every passenger's phone and email.
// The search lookups below stay fully public, so My Trips still works
// without a login when you search by reference, phone, email or name.
router.get('/', protect, c.getAllBookings);             // 2
router.get('/:bookingId', c.getBookingById);          // 3
router.put('/:bookingId', c.updateBooking);           // 9
router.patch('/:bookingId/cancel', c.cancelBooking);  // 10

module.exports = router;
