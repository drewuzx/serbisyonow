'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const scheduleWindow = require('../shared/js/schedule-window');

test('Manila schedule rules keep availability and service starts within their time window', () => {
 const now = new Date('2026-11-12T09:35:00.000Z');
 assert.deepEqual(scheduleWindow.manilaNow(now), { date: '2026-11-12', minutes: 17 * 60 + 35 });
 assert.equal(scheduleWindow.availabilityStartAllowed('2026-11-11', '18:00', now), false);
 assert.equal(scheduleWindow.availabilityStartAllowed('2026-11-12', '17:34', now), false);
 assert.equal(scheduleWindow.availabilityStartAllowed('2026-11-12', '17:35', now), true);
 assert.equal(scheduleWindow.availabilityStartAllowed('2026-11-13', '08:00', now), true);
 const booking = { scheduled_date: '2026-11-12', scheduled_time: '5:35 PM' };
 assert.equal(scheduleWindow.canStartService(booking, new Date('2026-11-12T09:34:00.000Z')), false);
 assert.equal(scheduleWindow.canStartService(booking, now), true);
 assert.equal(scheduleWindow.canStartService({ ...booking, scheduled_date: '2026-11-13' }, now), false);
 assert.equal(scheduleWindow.startServiceMessage(booking), 'Service can start on 2026-11-12 at 5:35 PM (Manila time).');
});
