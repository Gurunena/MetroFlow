// scheduleRoutes.js – /api/schedules (Schedule Management module)
'use strict';

const express = require('express');
const c = require('../controllers/scheduleController');
const v = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
const admin = [protect, adminOnly];

// Public: the timetable is readable by anyone.
router.get('/', c.list);                                        // ?busId=&date=&routeId=&status=
router.get('/:scheduleId', c.getById);

// Operator only.
router.post('/', admin, v.validateScheduleCreate, c.create);
router.put('/:scheduleId', admin, v.validateScheduleUpdate, c.update);
router.delete('/:scheduleId', admin, c.remove);

module.exports = router;
