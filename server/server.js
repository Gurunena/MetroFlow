// server.js – entry point: loads config, connects MongoDB, starts the HTTP server
require('dotenv').config();

const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

async function start() {
  // The HTTP server comes up whether or not Mongo answers. Teammates working
  // on the front end can then open the pages without installing MongoDB –
  // /api replies 503 and the client-side mock fallback takes over. The
  // warning below is deliberately loud so a dead database is never mistaken
  // for a working one.
  try {
    await connectDB(MONGO_URI);
    console.log('MongoDB connected: ' + MONGO_URI);
  } catch (err) {
    console.warn('\n  MongoDB NOT connected – ' + err.message);
    console.warn('  /api/* will answer 503 until the database is reachable.');
    console.warn('  Fix: start MongoDB, or set MONGO_URI in .env\n');
  }

  const server = app.listen(PORT, () => {
    console.log('MetroFlow running at http://localhost:' + PORT);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('Port ' + PORT + ' is already in use. Set PORT in .env.');
      process.exit(1);
    }
    throw err;
  });

  // Close the database cleanly on Ctrl+C / nodemon restarts.
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      server.close(() => {
        disconnectDB().finally(() => process.exit(0));
      });
    });
  });
}

start();
