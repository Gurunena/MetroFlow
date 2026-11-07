// contactController.js – handles contact-form submissions and the admin inbox
const Message = require('../models/Message');

/* ============================== responses ============================== */
// Same shape as the rest of the API: { success, count?, data } / { success, error }
function ok(res, data, status) {
  const body = { success: true };
  if (Array.isArray(data)) { body.count = data.length; }
  body.data = data;
  return res.status(status || 200).json(body);
}

function fail(res, status, error, details) {
  const body = { success: false, error };
  if (details) { body.details = details; }
  return res.status(status || 500).json(body);
}

/* =============================== sanitising ============================= */
/**
 * Trims, collapses runs of whitespace and drops the characters that would
 * let stored text be read as markup. The front end escapes on output too –
 * this is the second layer, so a message is never dangerous at rest.
 * Newlines are kept in the message body, which is why `keepBreaks` exists.
 */
function clean(value, keepBreaks) {
  if (value == null) { return ''; }
  let text = String(value)
    .replace(/[<>]/g, '')              // no tags can survive storage
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  text = keepBreaks
    ? text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ');

  return text.trim();
}

/* ============================== rate limit ============================= */
// 5 messages per IP per 15 minutes, kept in memory so no extra package is
// needed. Resets when the server restarts, which is fine for this project.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const hits = new Map();                  // ip -> [timestamp, timestamp, ...]

function clientIp(req) {
  // trust proxy is off, so req.ip is the socket address; the header is only a
  // fallback for when this ever runs behind one.
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function recent(ip, now) {
  return (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
}

// Peek only. The quota counts messages that were actually stored, so a
// visitor who mistypes their email and fixes it does not burn an attempt.
function overLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const stamps = recent(ip, now);
  hits.set(ip, stamps);                  // prune while we are here
  return stamps.length >= RATE_LIMIT;
}

function recordHit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const stamps = recent(ip, now);
  stamps.push(now);
  hits.set(ip, stamps);

  // Opportunistic sweep so a long-running server does not grow the map
  // forever once an address stops posting.
  if (hits.size > 500) {
    hits.forEach((old, key) => {
      if (!old.some((t) => now - t < RATE_WINDOW_MS)) { hits.delete(key); }
    });
  }
}

/* ============================== validation ============================= */
function validate(body) {
  const errors = {};

  const fullName = clean(body.Full_Name);
  const email = clean(body.Email).toLowerCase();
  const phone = clean(body.Phone).replace(/[\s-]/g, '');
  const subject = clean(body.Subject);
  const message = clean(body.Message, true);

  if (fullName.length < 2 || fullName.length > 60) {
    errors.Full_Name = 'Please enter your full name (2–60 characters).';
  }
  if (!Message.EMAIL_RE.test(email) || email.length > 100) {
    errors.Email = 'Please enter a valid email address.';
  }
  if (phone && !Message.PHONE_RE.test(phone)) {
    errors.Phone = 'Phone must look like +94771234567 or 0771234567.';
  }
  if (Message.SUBJECTS.indexOf(subject) === -1) {
    errors.Subject = 'Please choose a subject from the list.';
  }
  if (message.length < 20 || message.length > 1000) {
    errors.Message = 'Your message must be between 20 and 1000 characters.';
  }

  const doc = { Full_Name: fullName, Email: email, Subject: subject, Message: message };
  if (phone) { doc.Phone = phone; }

  return { doc, errors, hasErrors: Object.keys(errors).length > 0 };
}

/* ================================ handlers ============================= */

/**
 * POST /api/contact – public. Creates a message.
 *
 * A filled honeypot means a bot walked the form, so the request is dropped
 * and answered with an ordinary 201: telling the bot it was detected only
 * teaches it to try again without the trap.
 */
async function create(req, res) {
  try {
    const body = req.body || {};

    const honeypot = clean(body.Website || body.website || body.Company_Website);
    if (honeypot) {
      const now = new Date();
      const dateKey = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
      console.warn('Contact form honeypot tripped from ' + clientIp(req) + ' – not stored');
      // -000 can never collide with a stored message: real ones start at 001.
      return ok(res, { Message_ID: 'MSG-' + dateKey + '-000', Status: 'New' }, 201);
    }

    if (overLimit(req)) {
      return fail(res, 429, 'Too many messages from this address. Please try again in 15 minutes.');
    }

    const { doc, errors, hasErrors } = validate(body);
    if (hasErrors) {
      return fail(res, 400, 'Please check the highlighted fields.', errors);
    }

    const saved = await Message.create(doc);
    recordHit(req);                      // only a stored message counts

    return ok(res, {
      Message_ID: saved.Message_ID,
      Full_Name: saved.Full_Name,
      Subject: saved.Subject,
      Status: saved.Status,
      Created_At: saved.Created_At
    }, 201);
  } catch (err) {
    if (err && err.name === 'ValidationError') {
      const details = {};
      Object.keys(err.errors).forEach((key) => { details[key] = err.errors[key].message; });
      return fail(res, 400, 'Please check the highlighted fields.', details);
    }
    console.error('POST /api/contact failed:', err);
    return fail(res, 500, 'Could not send your message. Please try again.');
  }
}

/**
 * GET /api/contact?status=New – admin only.
 * Newest first. No admin UI is built for this; it is here for the teammate
 * who owns admin.html to list the inbox.
 */
async function list(req, res) {
  try {
    const filter = {};
    const status = clean((req.query || {}).status);

    if (status && status !== 'All') {
      if (Message.STATUSES.indexOf(status) === -1) {
        return fail(res, 400, 'Unknown status: ' + status +
          '. Use one of: ' + Message.STATUSES.join(', '));
      }
      filter.Status = status;
    }

    const limit = Math.min(Math.max(parseInt((req.query || {}).limit, 10) || 100, 1), 200);

    const docs = await Message.find(filter)
      .sort({ Created_At: -1 })
      .limit(limit)
      .lean();

    docs.forEach((d) => { delete d._id; });

    return ok(res, docs);
  } catch (err) {
    console.error('GET /api/contact failed:', err);
    return fail(res, 500, 'Could not load messages');
  }
}

/**
 * PATCH /api/contact/:messageId – admin only. Updates Status.
 */
async function updateStatus(req, res) {
  try {
    const messageId = clean(req.params.messageId).toUpperCase();
    const status = clean((req.body || {}).Status || (req.body || {}).status);

    if (Message.STATUSES.indexOf(status) === -1) {
      return fail(res, 400, 'Status must be one of: ' + Message.STATUSES.join(', '));
    }

    const updated = await Message.findOneAndUpdate(
      { Message_ID: messageId },
      { $set: { Status: status } },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return fail(res, 404, 'No message with ID ' + messageId);
    }

    delete updated._id;
    return ok(res, updated);
  } catch (err) {
    console.error('PATCH /api/contact failed:', err);
    return fail(res, 500, 'Could not update the message');
  }
}

module.exports = { create, list, updateStatus };
