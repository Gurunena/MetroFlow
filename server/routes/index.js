// index.js – mounts all API route modules on a single router
const express = require('express');

const router = express.Router();

/**
 * Several route modules in this project are still being written, and a
 * half-finished one throws at require/mount time (for example
 * routeScheduleRoutes depends on middleware/auth, which is still a stub, so
 * `auth.requireAdmin` is undefined and Express rejects it as a handler).
 *
 * Mounting each module on its own means one unfinished file cannot stop the
 * whole API from booting: the finished routers still serve, and the skipped
 * one starts working the moment its dependency lands. Every skip is logged
 * loudly so it is never silently missing.
 */
function mount(path, modulePath, label) {
  try {
    // eslint-disable-next-line global-require
    const mod = require(modulePath);
    router.use(path, mod);
    console.log('  mounted  /api' + path + '  (' + label + ')');
    return true;
  } catch (err) {
    console.warn('  SKIPPED  /api' + path + '  (' + label + ') – ' + err.message);
    return false;
  }
}

console.log('Mounting API routes:');
// busRoutes.js currently cannot load (its handler names no longer match
// busController.js). Fall back to the read-only search endpoints so the
// search page works; the team's router wins again as soon as it loads.
if (!mount('/buses', './busRoutes', 'bus management')) {
  mount('/buses', './busSearchRoutes', 'bus search (fallback)');
}
mount('/bookings', './bookingRoutes', 'bookings');
mount('/passengers', './passengerRoutes', 'passengers');
mount('/destinations', './destinationRoutes', 'destinations');
mount('/routes', './routeRoutes', 'route management');
// The team's routeScheduleRoutes.js is a different design (a timetable view
// keyed by Bus_ID) and has never loaded — its controller requires
// ../services/routeScheduleService while the file on disk is
// routeScheduleServices.js. The assignment's /api/schedules contract is
// keyed by Schedule_ID, so the new scheduleRoutes.js serves it; the old
// file is left untouched on disk.
mount('/schedules', './scheduleRoutes', 'schedule management');
mount('/auth', './authRoutes', 'authentication');
mount('/chat', './chatRoutes', 'chat');
mount('/contact', './contactRoutes', 'contact messages');

// Simple liveness probe, handy for checking the API is actually reachable.
router.get('/health', (req, res) => {
  const { isConnected } = require('../config/db');
  const connected = isConnected();
  res.json({
    success: true,
    // Flat keys are what the brief asks for; `data` keeps the envelope
    // consistent with every other endpoint.
    status: 'ok',
    db: connected ? 'connected' : 'disconnected',
    data: { api: 'up', status: 'ok', database: connected ? 'connected' : 'disconnected' }
  });
});

// Dashboard counters. There is no stats collection: the figures are derived
// so they can never drift from the real documents.
router.get('/stats', require('../middleware/auth').protect,
  require('../middleware/auth').adminOnly, async (req, res) => {
    try {
      const Bus = require('../models/Bus');
      const Booking = require('../models/Booking');

      const now = new Date();
      const todayStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      const [totalBuses, totalBookings, todaysBookings, confirmed, revenue] = await Promise.all([
        Bus.countDocuments({}),
        Booking.countDocuments({}),
        Booking.countDocuments({ Travel_Date: todayStr, Booking_Status: 'Confirmed' }),
        Booking.countDocuments({ Booking_Status: 'Confirmed' }),
        Booking.aggregate([
          { $match: { Booking_Status: 'Confirmed' } },
          { $group: { _id: null, total: { $sum: '$Fare' } } }
        ])
      ]);

      return res.json({
        success: true,
        data: {
          totalBuses,
          totalBookings,
          todaysBookings,
          seatsSold: confirmed,
          revenue: (revenue[0] && revenue[0].total) || 0
        }
      });
    } catch (err) {
      console.error('GET /api/stats failed:', err);
      return res.status(500).json({ success: false, message: 'Could not build the statistics' });
    }
  });

module.exports = router;
