// db.js – MongoDB connection setup via Mongoose
const mongoose = require('mongoose');

// Fail fast rather than letting queries hang for the default 30s when there
// is no server listening on MONGO_URI.
const OPTIONS = { serverSelectionTimeoutMS: 5000 };

/**
 * Opens the shared Mongoose connection.
 * Rejects if the database cannot be reached; the caller decides whether that
 * is fatal (see server.js, which keeps serving static files either way).
 */
async function connectDB(uri) {
  if (!uri) {
    throw new Error('MONGO_URI is not set – copy .env.example to .env');
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, OPTIONS);
  return mongoose.connection;
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB, isConnected };
