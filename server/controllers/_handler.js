// _handler.js – the thin-controller wrapper shared by the route, schedule
// and stats controllers. Keeps controllers to one line each: call the
// service, wrap the result in the project's standard envelope.
'use strict';

const { ApiError } = require('../utils/response');

// success: { success, message?, count?, data }
// failure: { success, message, errors? }  (shape fixed by the brief)
function fail(res, err) {
  if (err instanceof ApiError) {
    const body = { success: false, message: err.message };
    if (err.details) { body.errors = err.details; }
    return res.status(err.status).json(body);
  }
  if (err && err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid value for ' + err.path });
  }
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
    return res.status(409).json({ success: false, message: field + ' already exists' });
  }
  console.error('API error:', err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

function handler(run, options) {
  const opts = options || {};
  return async (req, res) => {
    try {
      const data = await run(req);
      const body = { success: true };
      if (opts.message) { body.message = opts.message; }
      if (Array.isArray(data)) { body.count = data.length; }
      body.data = data;
      return res.status(opts.status || 200).json(body);
    } catch (err) {
      return fail(res, err);
    }
  };
}

module.exports = { handler, fail };
