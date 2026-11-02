/**
 * /api/buses
 * NOTE: static paths (/available, /route/…, /date/…) are declared BEFORE /:busId
 * so Express does not treat "available" as a Bus_ID.
 */
const router = require('express').Router();
const c = require('../controllers/busController');
const { requireAdmin } = require('../middleware/auth');
const v = require('../middleware/validate');

// Helpers
router.get('/popular', c.popular);
router.get('/locations', c.locations);

// Search services
router.get('/available', c.available);                                  // 8
router.get('/route/:route', c.byRoute);                                 // 4
router.get('/departure/:departure', c.byDeparture);                     // 5
router.get('/destination/:destination', c.byDestination);               // 6
router.get('/date/:date', v.validateDateParam, c.byDate);               // 7

// Collection
router.get('/', c.list);                                                // 2
router.post('/', requireAdmin, v.validateBusCreate, c.create);          // 1

// Single bus
router.get('/:busId/seats', c.seats);
router.patch('/:busId/schedule', requireAdmin, v.validateSchedule, c.updateSchedule); // 10
router.get('/:busId', c.getById);                                       // 3
router.put('/:busId', requireAdmin, v.validateBusUpdate, c.update);     // 9
router.delete('/:busId', requireAdmin, c.remove);                       // 11

module.exports = router;
