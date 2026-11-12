(function (root, factory) {
 'use strict';
 const api = factory(requireTime());
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNScheduleWindow = api;

 function requireTime() {
  if (typeof module === 'object' && module.exports) return require('./time-format');
  return root.SNTime;
 }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (time) {
 'use strict';

 function manilaNow(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
   timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
   hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
   date: `${values.year}-${values.month}-${values.day}`,
   minutes: Number(values.hour) * 60 + Number(values.minute),
  };
 }

 function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
 }

 function availabilityStartAllowed(date, startTime, now = new Date()) {
  const day = dateKey(date), current = manilaNow(now), start = time.minutes(startTime);
  return Boolean(day && start !== null && day >= current.date && (day !== current.date || start >= current.minutes));
 }

 function canStartService(booking, now = new Date()) {
  if (!booking) return false;
  const current = manilaNow(now);
  const scheduled = time.minutes(booking.scheduled_time);
  return dateKey(booking.scheduled_date) === current.date && scheduled !== null && current.minutes >= scheduled;
 }

 function startServiceMessage(booking) {
  const date = dateKey(booking?.scheduled_date);
  const scheduled = time.format(booking?.scheduled_time, 'the scheduled time');
  return `Service can start on ${date || 'the scheduled date'} at ${scheduled} (Manila time).`;
 }

 return { manilaNow, dateKey, availabilityStartAllowed, canStartService, startServiceMessage };
});
