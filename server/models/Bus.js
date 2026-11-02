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

busSchema.pre('validate', function () {
  if (this.Departure_Time && this.Arrival_Time && this.Arrival_Time <= this.Departure_Time) {
    this.invalidate('Arrival_Time', 'Arrival_Time must be after Departure_Time');
  }
});

module.exports = mongoose.model('Bus', busSchema);
