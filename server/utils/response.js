// response.js – helpers for consistent JSON API success and error responses

/**
 * An error carrying the HTTP status the API should answer with.
 * busController checks `err.status`, `err.message` and `err.details`.
 */
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 500;
    if (details) { this.details = details; }
    Error.captureStackTrace(this, ApiError);
  }
}

// success:  { success: true, message?, count?, data }
function ok(res, data, extra) {
  const body = { success: true };
  if (Array.isArray(data)) { body.count = data.length; }
  body.data = data;
  if (extra) { Object.assign(body, extra); }
  return res.status((extra && extra.status) || 200).json(body);
}

// failure:  { success: false, error, details? }
function fail(res, status, error, details) {
  const body = { success: false, error };
  if (details) { body.details = details; }
  return res.status(status || 500).json(body);
}

module.exports = { ApiError, ok, fail };
// busService throws ApiError; busController destructures `ServiceError`, so
// expose the same class under that name too.
module.exports.ServiceError = ApiError;
