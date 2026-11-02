// authController.js – handles login, registration and token issuing requests
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const BCRYPT_ROUNDS = 10;
const USER_TOKEN_TTL = '7d';
const ADMIN_TOKEN_TTL = '2h';

// Auth replies use { success, message } – see README note about the bus/booking
// APIs using { success, error }.
function ok(res, data, status) {
  return res.status(status || 200).json({ success: true, data });
}
function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value === 'change_this_secret') {
    // Refuse to mint tokens with the placeholder secret from .env.example.
    throw new Error('JWT_SECRET is not configured');
  }
  return value;
}

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.Role, email: user.Email },
    secret(),
    { expiresIn: user.Role === 'admin' ? ADMIN_TOKEN_TTL : USER_TOKEN_TTL }
  );
}

/* ----------------------------- validation ------------------------------ */
// The client validates too, but never trust it – every field is re-checked.

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateRegister(body) {
  const errors = [];
  const Full_Name = cleanString(body.Full_Name);
  const Email = cleanString(body.Email).toLowerCase();
  const Phone = cleanString(body.Phone);
  const Password = typeof body.Password === 'string' ? body.Password : '';

  if (Full_Name.length < 2 || Full_Name.length > 60) {
    errors.push('Full name must be between 2 and 60 characters');
  }
  if (!User.EMAIL_RE.test(Email)) {
    errors.push('Please enter a valid email address');
  }
  if (!User.PHONE_RE.test(Phone)) {
    errors.push('Phone must look like +94771234567 or 0771234567');
  }
  if (Password.length < 8) {
    errors.push('Password must be at least 8 characters');
  } else if (!/[a-z]/.test(Password) || !/[A-Z]/.test(Password) || !/\d/.test(Password)) {
    errors.push('Password needs an uppercase letter, a lowercase letter and a number');
  }

  return { errors, values: { Full_Name, Email, Phone, Password } };
}

/* ------------------------------- handlers ------------------------------- */

// POST /api/auth/register
async function register(req, res) {
  try {
    const { errors, values } = validateRegister(req.body || {});
    if (errors.length) { return fail(res, 400, errors[0]); }

    const existing = await User.findOne({ Email: values.Email }).lean();
    if (existing) {
      return fail(res, 409, 'An account with that email already exists');
    }

    const Password_Hash = await bcrypt.hash(values.Password, BCRYPT_ROUNDS);
    const user = await User.create({
      Full_Name: values.Full_Name,
      Email: values.Email,
      Phone: values.Phone,
      Password_Hash,
      Role: 'passenger'
    });

    return ok(res, { token: signToken(user), user: user.toProfile() }, 201);
  } catch (err) {
    // A racing duplicate slips past the findOne check and lands here.
    if (err && err.code === 11000) {
      return fail(res, 409, 'An account with that email already exists');
    }
    if (err && err.name === 'ValidationError') {
      const first = Object.values(err.errors)[0];
      return fail(res, 400, first ? first.message : 'Validation failed');
    }
    console.error('register failed:', err.message);
    return fail(res, 500, 'Could not create your account. Please try again.');
  }
}

// Shared by login and admin-login. `adminOnly` rejects passenger accounts.
async function authenticate(req, res, adminOnly) {
  const Email = cleanString((req.body || {}).Email).toLowerCase();
  const Password = typeof (req.body || {}).Password === 'string' ? req.body.Password : '';

  if (!Email || !Password) {
    return fail(res, 400, 'Email and password are both required');
  }

  // Password_Hash is select:false, so ask for it explicitly.
  const user = await User.findOne({ Email }).select('+Password_Hash');

  // Deliberately the same message whether the email is unknown or the
  // password is wrong, so the endpoint cannot be used to enumerate accounts.
  const GENERIC = 'Invalid email or password';
  if (!user) { return fail(res, 401, GENERIC); }

  const matches = await bcrypt.compare(Password, user.Password_Hash);
  if (!matches) { return fail(res, 401, GENERIC); }

  if (adminOnly && user.Role !== 'admin') {
    return fail(res, 403, 'This account is not authorised for the depot control room');
  }

  return ok(res, { token: signToken(user), user: user.toProfile() });
}

// POST /api/auth/login
async function login(req, res) {
  try {
    return await authenticate(req, res, false);
  } catch (err) {
    console.error('login failed:', err.message);
    return fail(res, 500, 'Could not sign you in. Please try again.');
  }
}

// POST /api/auth/admin-login
async function adminLogin(req, res) {
  try {
    return await authenticate(req, res, true);
  } catch (err) {
    console.error('admin-login failed:', err.message);
    return fail(res, 500, 'Could not sign you in. Please try again.');
  }
}

// GET /api/auth/me – behind `protect`
async function me(req, res) {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) { return fail(res, 401, 'That account no longer exists'); }
    return ok(res, { user: user.toProfile() });
  } catch (err) {
    console.error('me failed:', err.message);
    return fail(res, 500, 'Could not load your profile');
  }
}

// POST /api/auth/logout – stateless; the client discards the token.
function logout(req, res) {
  return ok(res, { message: 'Signed out' });
}

module.exports = { register, login, adminLogin, me, logout };
