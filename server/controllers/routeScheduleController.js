// routeScheduleController.js – handles Route & Schedule REST API requests
const service = require('../services/routeScheduleService');
const { ServiceError } = require('../services/busService');

// success: { success: true, message?, count?, data }   failure: { success: false, error, details? }
// (same shape as busController so the front end handles both the same way)
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
  console.error('Route/Schedule API error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

function handler(run, message) {
  return async (req, res) => {
    try {
      const data = await run(req);
      const body = { success: true };
      if (message) body.message = message;
      if (Array.isArray(data)) body.count = data.length;
      body.data = data;
      res.json(body);
    } catch (err) {
      fail(res, err);
    }
  };
}

module.exports = {
  timetable: handler((req) => service.searchTimetable(req.query)),
  routeSummary: handler(() => service.routeSummary()),
  updateRoute: handler((req) => service.updateRoute(req.params.busId, req.body), 'Route updated successfully'),
  updateSchedule: handler((req) => service.updateSchedule(req.params.busId, req.body), 'Schedule updated successfully')
};
