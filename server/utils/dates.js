// dates.js – small date helpers shared by the services
// Travel_Date is stored as a "YYYY-MM-DD" string, so these work on strings
// rather than Date objects to avoid timezone drift.

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in local time as "YYYY-MM-DD". */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * True only for a real calendar date in YYYY-MM-DD form.
 * "2026-02-30" matches the pattern but is not a real day, so it is rejected.
 */
function isValidYMD(value) {
  if (typeof value !== 'string' || !YMD_RE.test(value)) { return false; }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Shifts a "YYYY-MM-DD" string by whole days, returning the same format. */
function addDays(value, days) {
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0');
}

module.exports = { todayStr, isValidYMD, addDays, YMD_RE };
