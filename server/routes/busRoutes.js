// busRoutes.js – Routes for Bus Management

const express = require('express');
const router = express.Router();

const controller = require('../controllers/busController');
const auth = require('../middleware/auth');

// View all buses
router.get('/', controller.getAllBuses);

// Search available buses
router.get('/available', controller.getAvailable);

// Get locations
router.get('/locations', controller.getLocations);

// Search buses
router.get('/route/:route', controller.getByRoute);
router.get('/departure/:departure', controller.getByDeparture);
router.get('/destination/:destination', controller.getByDestination);
router.get('/date/:date', controller.getByDate);

// Get bus by ID
router.get('/:busId', controller.getBusById);

// Add bus
router.post('/', auth.requireAdmin, controller.createBus);

// Update bus
router.put('/:busId', auth.requireAdmin, controller.updateBus);

// Update bus schedule
router.patch('/:busId/schedule', auth.requireAdmin, controller.updateSchedule);

// Delete bus
router.delete('/:busId', auth.requireAdmin, controller.deleteBus);

module.exports = router;
