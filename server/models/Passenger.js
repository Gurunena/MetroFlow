// Passenger.js – Mongoose schema and model for passengers (Member 3)
const mongoose = require('mongoose');

const GENDERS = ['Male', 'Female', 'Other', ''];

const NIC_RE = /^([0-9]{9}[VvXx]|[0-9]{12}|[A-Za-z][0-9]{7,8})$/; // old NIC, new NIC or passport
const PHONE_RE = /^(\+94\d{9}|0\d{9})$/;                         // +94771234567 or 0771234567
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const passengerSchema = new mongoose.Schema(
  {
    Passenger_ID: { type: String, required: true, unique: true, trim: true, uppercase: true },
    Full_Name: {
      type: String,
      alias: 'Passenger_Name',   // the brief's name for this field
      required: [true, 'Full_Name is required'],
      trim: true,
      minlength: [2, 'Full_Name must be at least 2 characters'],
      maxlength: [60, 'Full_Name must be at most 60 characters']
    },
    NIC: {
      type: String,
      // Optional on purpose: creating a booking upserts a passenger from
      // name + phone + email, and a traveller does not give a NIC at that
      // point. `sparse` lets many documents have no NIC while the ones that
      // do stay unique. The admin passenger form still sends it.
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
      match: [NIC_RE, 'NIC must be 9 digits + V/X, 12 digits, or a passport number like N1234567']
    },
    Phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      match: [PHONE_RE, 'Phone must look like +94771234567 or 0771234567']
    },
    Email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: [EMAIL_RE, 'Email is not valid']
    },
    Address: { type: String, trim: true, maxlength: 150, default: '' },
    Gender: {
      type: String,
      enum: { values: GENDERS, message: 'Gender must be Male, Female or Other' },
      default: ''
    }
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: {
      virtuals: true,            // so Passenger_Name appears in responses
      transform: (doc, ret) => {
        delete ret._id; // API records follow the brief's style (no Mongo _id)
        delete ret.id;  // the virtual Mongoose adds alongside _id
        if (ret.Full_Name !== undefined) { ret.Passenger_Name = ret.Full_Name; }
        return ret;
      }
    }
  }
);

// Optional link to the account the passenger signed in with (User 1 -- 0..1
// Passenger). Left unset for guest bookings.
passengerSchema.add({
  User_Ref: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

// Indexes for the search box
passengerSchema.index({ Full_Name: 1 });
passengerSchema.index({ Phone: 1 });
passengerSchema.index({ Email: 1 });
// Bookings upsert a passenger on this pair, so it must be fast and unique.
passengerSchema.index({ Email: 1, Phone: 1 }, { unique: true });

const Passenger = mongoose.model('Passenger', passengerSchema);

module.exports = Passenger;
module.exports.NIC_RE = NIC_RE;
module.exports.PHONE_RE = PHONE_RE;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.GENDERS = GENDERS;
