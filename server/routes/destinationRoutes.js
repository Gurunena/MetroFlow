// destinationRoutes.js – defines /api/destinations endpoints (Explore page)
const express = require('express');

const controller = require('../controllers/destinationController');

const router = express.Router();

// Specific path first, so ":slug" cannot swallow it.
router.get('/', controller.list);                      // ?category=&search=&popular=&sort=
router.get('/:slug/buses', controller.busesTo);        // upcoming services + summary
router.get('/:slug', controller.getBySlug);            // one destination

module.exports = router;
