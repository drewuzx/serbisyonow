(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';
 // Time-only booking values are local wall-clock times, not UTC timestamps.
 function minutes(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]), second = Number(match[3] || 0), period = match[4]?.toUpperCase();
  if (minute > 59 || second > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0);
  return hour * 60 + minute;
 }
 function format(value, fallback = '-') {
  const total = minutes(value);
  if (total === null) return fallback;
  const hour = Math.floor(total / 60);
  return `${hour % 12 || 12}:${String(total % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
 }
 function to24(value) {
  const total = minutes(value);
  return total === null ? '' : `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
 }
 return { format, minutes, to24 };
});
