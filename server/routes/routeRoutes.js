// routeRoutes.js – /api/routes (Route Management module)
'use strict';

const express = require('express');
const c = require('../controllers/routeController');
const v = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
const admin = [protect, adminOnly];

// Public: passengers browse the network.
router.get('/', c.list);                                        // ?status=&from=&to=&search=
router.get('/:routeId', c.getById);

// Operator only.
router.post('/', admin, v.validateRouteCreate, c.create);
router.put('/:routeId', admin, v.validateRouteUpdate, c.update);
router.delete('/:routeId', admin, c.remove);

module.exports = router;
