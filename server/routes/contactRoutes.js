// contactRoutes.js – defines /api/contact endpoints (Contact page + admin inbox)
const express = require('express');

const controller = require('../controllers/contactController');

const router = express.Router();

/**
 * The two read/write endpoints are for operators only. middleware/auth.js is
 * finished, but it was a stub until recently and this router is mounted by
 * routes/index.js, so guard the lookup: if `protect`/`adminOnly` ever go
 * missing again the public POST must still work rather than the whole
 * router failing to mount.
 */
function adminGuard() {
  try {
    // eslint-disable-next-line global-require
    const auth = require('../middleware/auth');
    if (typeof auth.protect === 'function' && typeof auth.adminOnly === 'function') {
      return [auth.protect, auth.adminOnly];
    }
    console.warn('  contactRoutes: auth middleware incomplete – /api/contact ' +
      'GET and PATCH are UNPROTECTED');
  } catch (err) {
    console.warn('  contactRoutes: auth middleware unavailable (' + err.message +
      ') – /api/contact GET and PATCH are UNPROTECTED');
  }
  return [];
}

const admin = adminGuard();

// Public: the contact form posts here.
router.post('/', controller.create);

// Admin only: inbox listing and status updates.
router.get('/', admin, controller.list);                       // ?status=New&limit=50
router.patch('/:messageId', admin, controller.updateStatus);   // { "Status": "Read" }

module.exports = router;
