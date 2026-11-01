// routeScheduleRoutes.js – defines /api/schedules endpoints (Route & Schedule Management)
const express = require('express');
const router = express.Router();

const controller = require('../controllers/routeScheduleController');
const auth = require('../middleware/auth');

// Public (passengers can read the timetable)
router.get('/', controller.timetable);            // GET /api/schedules?route=&from=&to=&date=&availableOnly=true
router.get('/routes', controller.routeSummary);   // GET /api/schedules/routes

// Operator only
router.patch('/:busId/route', auth.requireAdmin, controller.updateRoute);       // PATCH /api/schedules/MB1001/route
router.patch('/:busId/schedule', auth.requireAdmin, controller.updateSchedule); // PATCH /api/schedules/MB1001/schedule

module.exports = router;
