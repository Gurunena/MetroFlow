// REST endpoints for Member 1 – Bus Management.
const express = require('express');
const controller = require('../controllers/busController');

const router = express.Router();

// Specific paths must be declared before /:busId.
router.get('/available', controller.getAvailable);
router.get('/locations', controller.getLocations);
router.get('/route/:route', controller.getByRoute);
router.get('/departure/:departure', controller.getByDeparture);
router.get('/destination/:destination', controller.getByDestination);
router.get('/date/:date', controller.getByDate);

router.get('/', controller.getAllBuses);
router.post('/', controller.createBus);
router.get('/:busId', controller.getBusById);
router.put('/:busId', controller.updateBus);
router.patch('/:busId/schedule', controller.updateSchedule);
router.delete('/:busId', controller.deleteBus);

module.exports = router;
