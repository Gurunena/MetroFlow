// bookingRoutes.js – defines /api/bookings endpoints
const express = require('express');
const c = require('../controllers/bookingController');

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
router.get('/', c.getAllBookings);                    // 2
router.get('/:bookingId', c.getBookingById);          // 3
router.put('/:bookingId', c.updateBooking);           // 9
router.patch('/:bookingId/cancel', c.cancelBooking);  // 10

module.exports = router;
