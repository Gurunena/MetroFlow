const mongoose = require('mongoose');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const busSchema = new mongoose.Schema(
  {
    Bus_ID: {
      type: String, required: [true, 'Bus_ID is required'], unique: true, index: true,
      trim: true, uppercase: true, match: [/^[A-Z]{2}\d{3,6}$/, 'Bus_ID must look like MB1001'],
    },
    Bus_Name: { type: String, required: [true, 'Bus_Name is required'], trim: true, maxlength: 60 },
    Route: { type: String, required: [true, 'Route is required'], trim: true, maxlength: 80 },
    Departure: { type: String, required: [true, 'Departure is required'], trim: true, maxlength: 60 },
    Destination: { type: String, required: [true, 'Destination is required'], trim: true, maxlength: 60 },
    Travel_Date: { type: String, required: [true, 'Travel_Date is required'], match: [DATE_RE, 'Travel_Date must be YYYY-MM-DD'], index: true },
    Departure_Time: { type: String, required: [true, 'Departure_Time is required'], match: [TIME_RE, 'Departure_Time must be HH:mm'] },
    Arrival_Time: { type: String, required: [true, 'Arrival_Time is required'], match: [TIME_RE, 'Arrival_Time must be HH:mm'] },
    Total_Seats: { type: Number, required: true, min: [1, 'Total_Seats must be ≥ 1'], max: [52, 'Total_Seats must be ≤ 52'], default: 50 },
    Available_Seats: {
      type: Number, required: true, min: [0, 'Available_Seats cannot be negative'],
      validate: { validator(v) { return v <= this.Total_Seats; }, message: 'Available_Seats cannot exceed Total_Seats' },
    },
    Fare: { type: Number, required: [true, 'Fare is required'], min: [0, 'Fare must be ≥ 0'] },
  },
  { timestamps: true, versionKey: false }
);

/**
 * ADDITIVE ONLY. The eleven assignment fields above are untouched, so every
 * existing response keeps its exact shape. These extras let a bus point at
 * its Route document without the front end noticing.
 */
busSchema.add({
  Route_ID: {
    type: String, trim: true, uppercase: true,
    match: [/^R\d{3,5}$/, 'Route_ID must look like R001']
  },
  Route_Ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  Bus_Type: { type: String, trim: true, maxlength: 40, default: 'Semi-Luxury' },
  Plate_No: { type: String, trim: true, uppercase: true, maxlength: 20 },
  // Deliberately NO default: bookingService treats a bus with any Status
  // other than 'Available' as unbookable, so defaulting this to 'Active'
  // silently made every bus unbookable. Left undefined, existing buses
  // behave exactly as they did before this field was added.
  Status: {
    type: String,
    enum: {
      values: ['Active', 'Available', 'Inactive'],
      message: 'Status must be Active, Available or Inactive'
    }
  }
});

// Available_Seats can never exceed Total_Seats, whatever writes the document.
busSchema.pre('validate', function checkSeatBounds() {
  if (this.Total_Seats !== undefined && this.Available_Seats !== undefined &&
      this.Available_Seats > this.Total_Seats) {
    this.invalidate('Available_Seats', 'Available_Seats cannot exceed Total_Seats');
  }
});

// The search page always filters on these three together.
// Travel_Date already carries index:true on the field above, so only the
// compound search index and the new route link are declared here.
busSchema.index({ Departure: 1, Destination: 1, Travel_Date: 1 });
busSchema.index({ Route_ID: 1 });

busSchema.pre('validate', function () {
  if (this.Departure_Time && this.Arrival_Time && this.Arrival_Time <= this.Departure_Time) {
    this.invalidate('Arrival_Time', 'Arrival_Time must be after Departure_Time');
  }
});

module.exports = mongoose.model('Bus', busSchema);
