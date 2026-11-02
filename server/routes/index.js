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
mount('/buses', './busRoutes', 'bus management');
mount('/bookings', './bookingRoutes', 'bookings');
mount('/destinations', './destinationRoutes', 'destinations');
mount('/schedules', './routeScheduleRoutes', 'routes & timetable');
mount('/auth', './authRoutes', 'authentication');
mount('/chat', './chatRoutes', 'chat');

// Simple liveness probe, handy for checking the API is actually reachable.
router.get('/health', (req, res) => {
  const { isConnected } = require('../config/db');
  res.json({
    success: true,
    data: { api: 'up', database: isConnected() ? 'connected' : 'disconnected' }
  });
});

module.exports = router;
