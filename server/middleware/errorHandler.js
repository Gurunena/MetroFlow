// errorHandler.js – the single Express error-handling middleware
//
// Every controller already answers its own expected failures; this catches
// what slips past (thrown ApiErrors, Mongoose errors, bad JSON, JWT errors)
// and turns it into the project's standard JSON shape. It must stay the LAST
// app.use() in app.js and must keep all four arguments, or Express will treat
// it as ordinary middleware.
'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) { return next(err); }

  // --- Mongoose validation: one entry per bad field ---------------------
  if (err && err.name === 'ValidationError' && err.errors) {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message
    }));
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  // --- Bad ObjectId / wrong type in a query ------------------------------
  if (err && err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid value for ' + err.path,
      errors: [{ field: err.path, message: 'Expected a ' + err.kind }]
    });
  }

  // --- Duplicate key on a unique index -----------------------------------
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
    const value = err.keyValue ? err.keyValue[field] : undefined;
    return res.status(409).json({
      success: false,
      message: value !== undefined
        ? field + ' "' + value + '" already exists'
        : field + ' already exists',
      errors: [{ field, message: 'Must be unique' }]
    });
  }

  // --- JWT -------------------------------------------------------------
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError')) {
    return res.status(401).json({ success: false, message: 'Your session is not valid, please sign in again' });
  }
  if (err && err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Your session has expired, please sign in again' });
  }

  // --- Malformed JSON body (express.json throws this) --------------------
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body is not valid JSON' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large' });
  }

  // --- Anything carrying its own status (ApiError / ServiceError) --------
  const status = err && (err.status || err.statusCode);
  if (status && status >= 400 && status < 500) {
    const body = { success: false, message: err.message || 'Request failed' };
    if (err.details) { body.errors = err.details; }
    return res.status(status).json(body);
  }

  // --- Genuine server fault ---------------------------------------------
  // Logged in full for the operator, never echoed to the client in
  // production: a stack trace tells an attacker the file layout.
  console.error('Unhandled error:', err && err.stack ? err.stack : err);

  const body = { success: false, message: 'Internal server error' };
  if (!IS_PROD && err && err.message) { body.detail = err.message; }
  return res.status(status || 500).json(body);
}

module.exports = errorHandler;
