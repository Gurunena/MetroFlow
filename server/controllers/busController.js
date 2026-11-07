// busController.js – handles bus REST API requests
const busService = require('../services/busService');
// busService throws ApiError from utils/response and has never exported a
// `ServiceError`, so destructuring it off the service gave `undefined` and
// `err instanceof undefined` threw a TypeError that killed the process the
// first time any bus route failed. Import the real class instead.
const { ApiError: ServiceError } = require('../utils/response');

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

/**
 * Export names match routes/busRoutes.js, and each one calls the function
 * busService actually exports. These two files had drifted apart (the
 * controller exported getAllBuses/getAvailable/... while the router asked
 * for list/available/..., and it called busService.listBuses/searchAvailable/
 * createBus/... which the service never exported), so the router threw at
 * mount time and /api/buses fell back to the read-only search router.
 */
module.exports = {
  // 1. Insert a Metro Bus
  create: handler((req) => busService.create(req.body), { status: 201, message: 'Bus added successfully' }),
  // 2. Show all Metro Buses
  list: handler((req) => busService.list(req.query)),
  // 3. Find a Metro Bus by Bus ID
  getById: handler((req) => busService.getBusOr404(req.params.busId)),
  // 4. Find Buses by Route
  byRoute: handler((req) => busService.findByRoute(req.params.route)),
  // 5. Find Buses by Departure Location
  byDeparture: handler((req) => busService.findByDeparture(req.params.departure)),
  // 6. Find Buses by Destination
  byDestination: handler((req) => busService.findByDestination(req.params.destination)),
  // 7. Find Buses by Travel Date
  byDate: handler((req) => busService.findByDate(req.params.date)),
  // 8. Find Available Buses
  available: handler((req) => busService.findAvailable(req.query)),
  // 9. Update Metro Bus Details
  update: handler((req) => busService.update(req.params.busId, req.body), { message: 'Bus updated successfully' }),
  // 10. Update Metro Bus Schedule
  updateSchedule: handler((req) => busService.updateSchedule(req.params.busId, req.body), { message: 'Schedule updated successfully' }),
  // 11. Delete Metro Bus by Bus ID
  remove: handler((req) => busService.remove(req.params.busId), { message: 'Bus deleted successfully' }),

  // helpers
  seats: handler((req) => busService.getSeatMap(req.params.busId, req.query.date)),
  popular: handler((req) => busService.popularRoutes(Number(req.query.limit) || 6)),
  locations: handler(() => busService.locations()),

  // Legacy aliases, kept so nothing that imported the old names breaks.
  createBus: handler((req) => busService.create(req.body), { status: 201, message: 'Bus added successfully' }),
  getAllBuses: handler((req) => busService.list(req.query)),
  getBusById: handler((req) => busService.getBusOr404(req.params.busId)),
  getByRoute: handler((req) => busService.findByRoute(req.params.route)),
  getByDeparture: handler((req) => busService.findByDeparture(req.params.departure)),
  getByDestination: handler((req) => busService.findByDestination(req.params.destination)),
  getByDate: handler((req) => busService.findByDate(req.params.date)),
  getAvailable: handler((req) => busService.findAvailable(req.query)),
  updateBus: handler((req) => busService.update(req.params.busId, req.body), { message: 'Bus updated successfully' }),
  deleteBus: handler((req) => busService.remove(req.params.busId), { message: 'Bus deleted successfully' }),
  getLocations: handler(() => busService.locations())
};
