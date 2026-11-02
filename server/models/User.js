// User.js – Mongoose schema and model for users and admins
const mongoose = require('mongoose');
const Counter = require('./Counter');

const ROLES = ['passenger', 'admin'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+94\d{9}|0\d{9})$/;        // +94771234567 or 0771234567
const MEMBER_RE = /^MF-\d{4}-\d{4}$/;           // MF-2026-0001

const userSchema = new mongoose.Schema(
  {
    Full_Name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Full name must be at least 2 characters'],
      maxlength: [60, 'Full name must be at most 60 characters']
    },
    Email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: [EMAIL_RE, 'Email is not valid']
    },
    Phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      match: [PHONE_RE, 'Phone must look like +94771234567 or 0771234567']
    },
    // Never selected by default, so it cannot leak into an API response by
    // accident. Queries that need it must opt in with .select('+Password_Hash').
    Password_Hash: {
      type: String,
      required: [true, 'Password_Hash is required'],
      select: false
    },
    Role: {
      type: String,
      enum: { values: ROLES, message: 'Role must be passenger or admin' },
      default: 'passenger'
    },
    Member_No: {
      type: String,
      unique: true,
      match: [MEMBER_RE, 'Member_No must look like MF-2026-0001']
    },
    Created_At: { type: Date, default: Date.now }
  },
  {
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.Password_Hash; // belt and braces alongside select: false
        return ret;
      }
    }
  }
);

/**
 * Member_No = "MF-" + year + 4-digit running number for that year.
 * $inc on the shared Counter is atomic, so two simultaneous registrations
 * can never be handed the same number.
 */
userSchema.pre('save', async function assignMemberNo() {
  if (this.Member_No) { return; }
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: 'member-' + year },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  this.Member_No = 'MF-' + year + '-' + String(counter.seq).padStart(4, '0');
});

// The profile shape the API hands back to the client.
userSchema.methods.toProfile = function toProfile() {
  return {
    Full_Name: this.Full_Name,
    Email: this.Email,
    Phone: this.Phone,
    Role: this.Role,
    Member_No: this.Member_No,
    Created_At: this.Created_At
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.PHONE_RE = PHONE_RE;
