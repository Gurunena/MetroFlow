// busController.js – handles bus REST API requests
const busService = require('../services/busService');
const { ServiceError } = busService;

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
    return res.status(409).json({ success: false, error: 'Bus_ID already exists' });
  }
  console.error('Bus API error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

// runs a service call and sends the result as JSON
function handler(run, options) {
  const opts = options || {};
  return async (req, res) => {
    try {
      const data = await run(req);
      const body = { success: true };
      if (opts.message) body.message = opts.message;
      if (Array.isArray(data)) body.count = data.length;
      body.data = data;
      res.status(opts.status || 200).json(body);
    } catch (err) {
      fail(res, err);
    }
  };
}

module.exports = {
  // 1. Insert a Metro Bus
  createBus: handler((req) => busService.createBus(req.body), { status: 201, message: 'Bus added successfully' }),
  // 2. Show all Metro Buses
  getAllBuses: handler(() => busService.listBuses()),
  // 3. Find a Metro Bus by Bus ID
  getBusById: handler((req) => busService.getBusById(req.params.busId)),
  // 4. Find Buses by Route
  getByRoute: handler((req) => busService.findByRoute(req.params.route)),
  // 5. Find Buses by Departure Location
  getByDeparture: handler((req) => busService.findByDeparture(req.params.departure)),
  // 6. Find Buses by Destination
  getByDestination: handler((req) => busService.findByDestination(req.params.destination)),
  // 7. Find Buses by Travel Date
  getByDate: handler((req) => busService.findByDate(req.params.date)),
  // 8. Find Available Buses
  getAvailable: handler((req) => busService.searchAvailable(req.query)),
  // 9. Update Metro Bus Details
  updateBus: handler((req) => busService.updateBus(req.params.busId, req.body), { message: 'Bus updated successfully' }),
  // 10. Update Metro Bus Schedule
  updateSchedule: handler((req) => busService.updateSchedule(req.params.busId, req.body), { message: 'Schedule updated successfully' }),
  // 11. Delete Metro Bus by Bus ID
  deleteBus: handler((req) => busService.deleteBus(req.params.busId), { message: 'Bus deleted successfully' }),
  // helper: places for autocomplete
  getLocations: handler(() => busService.getLocations())
};
