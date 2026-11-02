// authRoutes.js – defines /api/auth endpoints
const express = require('express');

const controller = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/register', controller.register);        // 201 / 400 / 409
router.post('/login', controller.login);              // 200 / 400 / 401
router.post('/admin-login', controller.adminLogin);   // 200 / 400 / 401 / 403
router.get('/me', protect, controller.me);            // 200 / 401
router.post('/logout', controller.logout);            // 200 (stateless)

module.exports = router;
