// app.js – configures the Express application (middleware, routes, error handling)
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const apiRoutes = require('./routes');
const { isConnected } = require('./config/db');

const app = express();

// ------------------------------- middleware -------------------------------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// --------------------------------- static ---------------------------------
// Serving the front-end from Express puts the pages and /api on the same
// origin, so the jQuery calls in home.js / chat.js need no CORS or base URL.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ----------------------------------- API ----------------------------------
// Every data route needs Mongo. Answering 503 here gives the front-end a
// clean failure to fall back from, instead of a query that hangs.
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || isConnected()) { return next(); }
  return res.status(503).json({
    success: false,
    error: 'Database unavailable – check MONGO_URI and that MongoDB is running'
  });
});

app.use('/api', apiRoutes);

// Unknown /api path: answer JSON rather than falling through to index.html.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'No such endpoint: ' + req.originalUrl });
});

// ------------------------------- error handler -----------------------------
// Replace with middleware/errorHandler.js once that stub is filled in.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

module.exports = app;
