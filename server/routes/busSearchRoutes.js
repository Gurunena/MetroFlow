// busSearchRoutes.js – read-only /api/buses endpoints for the search page.
// Mounted by routes/index.js ONLY when the team's busRoutes.js fails to load.
const express = require('express');

const c = require('../controllers/busSearchController');

const router = express.Router();

// Static paths before /:busId so "available" is not read as a Bus_ID.
router.get('/available', c.available);
router.get('/locations', c.locations);
router.get('/departure/:departure', c.byDeparture);
router.get('/destination/:destination', c.byDestination);
router.get('/date/:date', c.byDate);
router.get('/', c.list);
router.get('/:busId', c.getById);

module.exports = router;
