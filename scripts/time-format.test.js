'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../shared/js/time-format');

test('time-only values format consistently without timezone conversion', () => {
 for (const [input, expected] of [
  ['05:40','5:40 AM'], ['17:40','5:40 PM'], ['00:00','12:00 AM'], ['12:00','12:00 PM'],
  ['23:59:00','11:59 PM'], ['09:05:00.000','9:05 AM'], ['9:05 am','9:05 AM'],
  ['12:30 AM','12:30 AM'], ['12:30 PM','12:30 PM'], [' 1:05PM ','1:05 PM'],
 ]) assert.equal(time.format(input),expected);
});
test('invalid or missing values never become a misleading time', () => {
 for (const value of [null,undefined,'','bad','24:00','12:60','00:20 AM','13:00 PM','09:00:60','2026-10-20T09:00:00Z']) {
  assert.equal(time.format(value),'-');
  assert.equal(time.minutes(value),null);
  assert.equal(time.to24(value),'');
 }
 assert.equal(time.format(null,''),'');
});
test('AM/PM selectors produce unchanged API time format and chronological comparisons', () => {
 assert.equal(time.to24('12:05 AM'),'00:05');
 assert.equal(time.to24('12:05 PM'),'12:05');
 assert.equal(time.to24('5:40 PM'),'17:40');
 assert.equal(time.to24('05:40'),'05:40');
 assert.ok(time.minutes('1:00 PM') > time.minutes('11:00 AM'));
});
