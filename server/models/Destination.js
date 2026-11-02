// Destination.js – Mongoose schema and model for explorable destinations
const mongoose = require('mongoose');

const CATEGORIES = ['Culture', 'Beach', 'Nature', 'Hill Country', 'City', 'Wildlife'];

const ID_RE = /^D\d{3,5}$/;            // D001
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const destinationSchema = new mongoose.Schema(
  {
    Dest_ID: {
      type: String,
      required: [true, 'Dest_ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [ID_RE, 'Dest_ID must look like D001']
    },
    Name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 2,
      maxlength: 60
    },
    Slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [SLUG_RE, 'Slug must be lowercase words joined by hyphens']
    },
    Province: { type: String, required: true, trim: true, maxlength: 40 },
    Category: {
      type: String,
      required: true,
      enum: { values: CATEGORIES, message: 'Category must be one of: ' + CATEGORIES.join(', ') }
    },
    Tagline: { type: String, required: true, trim: true, maxlength: 120 },
    Description: { type: String, required: true, trim: true, maxlength: 1200 },
    Best_Season: { type: String, required: true, trim: true, maxlength: 60 },
    Highlights: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 8,
        message: 'Highlights can hold at most 8 entries'
      }
    },
    Image_URL: { type: String, required: true, trim: true },
    Gallery: { type: [String], default: [] },
    Lat: { type: Number, required: true, min: 5.5, max: 10.2 },   // Sri Lanka bounds
    Lng: { type: Number, required: true, min: 79.4, max: 82.1 },
    Rating: { type: Number, required: true, min: 0, max: 5 },
    Popular: { type: Boolean, default: false }
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        return ret;
      }
    }
  }
);

// The list endpoint filters on category/popular and sorts by rating or name.
destinationSchema.index({ Category: 1, Rating: -1 });
destinationSchema.index({ Popular: 1 });
// Text index backs ?search= across the places a visitor would actually type.
destinationSchema.index({ Name: 'text', Tagline: 'text', Province: 'text' });

const Destination = mongoose.model('Destination', destinationSchema);

module.exports = Destination;
module.exports.CATEGORIES = CATEGORIES;
