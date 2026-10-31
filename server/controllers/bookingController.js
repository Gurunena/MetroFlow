// bookingController.js – handles booking REST API requests
const bookingService = require('../services/bookingService');
const { ServiceError } = bookingService;

// Same JSON shape as the bus API:
// success:  { success: true, message?, count?, data }
// failure:  { success: false, error, details? }
function fail(res, err) {
  if (err instanceof ServiceError) {
    return res.status(err.status).json({ success: false, error: err.message, details: err.details });
  }
  if (err && err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return res.status(400).json({ success: false, error: details[0] ? details[0].message : 'Validation failed', details });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'Invalid value for ' + err.path });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, error: 'That seat is already booked' });
  }
  console.error('Booking API error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

// runs a service call and sends the result as JSON
function handler(run, options) {
  const opts = options || {};
  return async (req, res) => {
    try {
      const data = await run(req);
      const body = { success: true };
      if (opts.message) body.message = typeof opts.message === 'function' ? opts.message(data) : opts.message;
      if (Array.isArray(data)) body.count = data.length;
      body.data = data;
      res.status(opts.status || 200).json(body);
    } catch (err) {
      fail(res, err);
    }
  };
}

module.exports = {
  // 1. Insert a Passenger Booking
  createBooking: handler((req) => bookingService.createBooking(req.body),
    { status: 201, message: (b) => 'Booking ' + b.Booking_ID + ' confirmed' }),
  // 2. Show all Bookings
  getAllBookings: handler(() => bookingService.listBookings()),
  // 3. Find a Booking by Booking ID
  getBookingById: handler((req) => bookingService.getBookingById(req.params.bookingId)),
  // 4. Find Bookings by Passenger Name
  getByPassengerName: handler((req) => bookingService.findByPassengerName(req.params.name)),
  // 5. Find Bookings by Phone Number
  getByPhone: handler((req) => bookingService.findByPhone(req.params.phone)),
  // 6. Find Bookings by Email
  getByEmail: handler((req) => bookingService.findByEmail(req.params.email)),
  // 7. Find Bookings by Bus ID
  getByBusId: handler((req) => bookingService.findByBusId(req.params.busId)),
  // 8. Find Bookings by Travel Date
  getByTravelDate: handler((req) => bookingService.findByTravelDate(req.params.date)),
  // 9. Update Booking Details
  updateBooking: handler((req) => bookingService.updateBooking(req.params.bookingId, req.body),
    { message: 'Booking updated successfully' }),
  // 10. Cancel a Booking by Booking ID
  cancelBooking: handler((req) => bookingService.cancelBooking(req.params.bookingId),
    { message: (b) => 'Booking ' + b.Booking_ID + ' cancelled' }),
  // helper: seats already booked on a bus (for the seat map)
  getBookedSeats: handler((req) => bookingService.getBookedSeats(req.params.busId))
};
