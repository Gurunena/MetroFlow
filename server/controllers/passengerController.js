// passengerController.js – handles passenger REST API requests (Member 3)
const passengerService = require('../services/passengerService');
const { ServiceError } = passengerService;

// Same JSON shape as the bus and booking APIs:
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
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, error: 'That NIC / Passport is already registered' });
  }
  console.error('Passenger API error:', err);
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
  // 1. Add a passenger
  createPassenger: handler((req) => passengerService.createPassenger(req.body),
    { status: 201, message: (p) => 'Passenger ' + p.Passenger_ID + ' added successfully' }),
  // 2. View all passengers (?search= filters by ID, name, NIC, phone or email)
  getAllPassengers: handler((req) => passengerService.listPassengers(req.query.search)),
  // 3. View one passenger
  getPassengerById: handler((req) => passengerService.getPassengerById(req.params.passengerId)),
  // 4. Update a passenger
  updatePassenger: handler((req) => passengerService.updatePassenger(req.params.passengerId, req.body),
    { message: 'Passenger updated successfully' }),
  // 5. Delete a passenger
  deletePassenger: handler((req) => passengerService.deletePassenger(req.params.passengerId),
    { message: (p) => 'Passenger ' + p.Passenger_ID + ' deleted' })
};
