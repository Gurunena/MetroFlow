// Message.js – Mongoose schema and model for contact-form messages
const mongoose = require('mongoose');
const Counter = require('./Counter');

const SUBJECTS = [
  'General enquiry',
  'Booking help',
  'Cancellation',
  'Feedback',
  'Report a problem'
];

const STATUSES = ['New', 'Read', 'Resolved'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+94\d{9}|0\d{9})$/;          // +94771234567 or 0771234567
const MESSAGE_ID_RE = /^MSG-\d{8}-\d{3}$/;        // MSG-20261106-001

const messageSchema = new mongoose.Schema(
  {
    Message_ID: {
      type: String,
      required: [true, 'Message_ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [MESSAGE_ID_RE, 'Message_ID must look like MSG-20261106-001']
    },
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
      trim: true,
      lowercase: true,
      maxlength: [100, 'Email must be at most 100 characters'],
      match: [EMAIL_RE, 'Email is not valid']
    },
    // Optional: an empty string would fail `match`, so absent means absent.
    Phone: {
      type: String,
      trim: true,
      match: [PHONE_RE, 'Phone must look like +94771234567 or 0771234567']
    },
    Subject: {
      type: String,
      required: [true, 'Subject is required'],
      enum: { values: SUBJECTS, message: 'Subject must be one of: ' + SUBJECTS.join(', ') }
    },
    Message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      minlength: [20, 'Message must be at least 20 characters'],
      maxlength: [1000, 'Message must be at most 1000 characters']
    },
    Status: {
      type: String,
      enum: { values: STATUSES, message: 'Status must be New, Read or Resolved' },
      default: 'New'
    },
    Created_At: { type: Date, default: Date.now }
  },
  {
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        return ret;
      }
    }
  }
);

// The admin list filters on Status and always sorts newest first.
messageSchema.index({ Status: 1, Created_At: -1 });
messageSchema.index({ Created_At: -1 });

/**
 * Message_ID = "MSG-" + YYYYMMDD + 3-digit running number for that day, so
 * the first message today is MSG-20261106-001.
 *
 * Runs on `validate` rather than `save` because Message_ID is `required`:
 * assigning it in a pre('save') hook would race the built-in validator.
 * $inc on the shared Counter is atomic, so two messages posted in the same
 * millisecond can never be handed the same number.
 */
messageSchema.pre('validate', async function assignMessageId() {
  if (this.Message_ID) { return; }

  const now = new Date();
  const dateKey = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');

  const counter = await Counter.findOneAndUpdate(
    { _id: 'message-' + dateKey },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  this.Message_ID = 'MSG-' + dateKey + '-' + String(counter.seq).padStart(3, '0');
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
module.exports.SUBJECTS = SUBJECTS;
module.exports.STATUSES = STATUSES;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.PHONE_RE = PHONE_RE;
