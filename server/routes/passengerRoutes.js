// passengerRoutes.js – defines /api/passengers endpoints (Member 3)
// Passenger records hold personal data (NIC, phone, email), so every endpoint
// is for administrators only: the request must carry the admin's login token
// (auth.js sends it automatically as "Authorization: Bearer <token>").
const express = require('express');
const jwt = require('jsonwebtoken');
const c = require('../controllers/passengerController');

const router = express.Router();

// Allows the request only when it carries a valid, unexpired admin token
function requireAdmin(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ success: false, error: 'Admin login required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only administrators can manage passengers' });
    }
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Your admin session has expired – please log in again' });
  }
}

router.use(requireAdmin);

router.post('/', c.createPassenger);                // 1. Add passenger
router.get('/', c.getAllPassengers);                // 2. View all passengers (?search=)
router.get('/:passengerId', c.getPassengerById);    // 3. View passenger details
router.put('/:passengerId', c.updatePassenger);     // 4. Update passenger
router.delete('/:passengerId', c.deletePassenger);  // 5. Delete passenger

module.exports = router;
