// auth.js – JWT verification and admin authorisation middleware
const jwt = require('jsonwebtoken');

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/**
 * Verifies `Authorization: Bearer <token>` and puts the decoded payload on
 * req.user as { sub, role, email }. Responds 401 and stops the chain when the
 * header is missing, malformed, expired or signed with a different secret.
 */
function protect(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  if (!match) {
    return fail(res, 401, 'Sign in to continue');
  }

  try {
    req.user = jwt.verify(match[1], process.env.JWT_SECRET);
    return next();
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return fail(res, 401, 'Your session has expired, please sign in again');
    }
    return fail(res, 401, 'Your session is not valid, please sign in again');
  }
}

/**
 * Must run after `protect`. Rejects any token that is not an admin's.
 * Used as: router.post('/', protect, adminOnly, handler)
 */
function adminOnly(req, res, next) {
  if (!req.user) {
    return fail(res, 401, 'Sign in to continue');
  }
  if (req.user.role !== 'admin') {
    return fail(res, 403, 'Administrator access only');
  }
  return next();
}

/**
 * Convenience for routes that are public but behave differently when signed
 * in: attaches req.user when a valid token is present and never blocks.
 */
function optionalAuth(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec((req.headers.authorization || '').trim());
  if (match) {
    try {
      req.user = jwt.verify(match[1], process.env.JWT_SECRET);
    } catch (err) {
      // An invalid token on an optional route is simply ignored.
    }
  }
  return next();
}

module.exports = { protect, adminOnly, optionalAuth };

// `requireAdmin` is the name routeScheduleRoutes.js expects, so expose it as
// an alias (protect + adminOnly in one) rather than make that file change.
module.exports.requireAdmin = [protect, adminOnly];
