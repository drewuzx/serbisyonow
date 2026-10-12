'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const events = new Map();
  const timers = new Map();
  let id = 0;
  let now = 0;
  const on = (name, callback) => events.set(name, [...(events.get(name) || []), callback]);
  const document = { visibilityState: 'visible', addEventListener: on };
  const navigator = { onLine: true };
  const addTimer = (callback, delay, repeat) => { const key = ++id; timers.set(key, { callback, at: now + delay, repeat }); return key; };
  const window = {
    addEventListener: on,
    clearInterval: key => timers.delete(key), clearTimeout: key => timers.delete(key),
    setInterval(callback, delay) { assert.equal(delay, 3000); return addTimer(callback, delay, delay); },
    setTimeout: (callback, delay) => addTimer(callback, delay, 0),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/js/live-refresh.js'), 'utf8'), { window, document, navigator, Date: { now: () => now }, console: { warn() {} } });
  const advance = async ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end);
      if (!next) break;
      const [key, timer] = next;
      now = timer.at;
      if (timer.repeat) timer.at += timer.repeat; else timers.delete(key);
      timer.callback();
      await settle();
    }
    now = end;
  };
  return { live: window.snLiveRefresh, document, navigator, tick: () => advance(3000), advance, emit: name => (events.get(name) || []).forEach(callback => callback()) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('refreshes every three seconds without overlapping slow requests', async () => {
  const f = fixture();
  let calls = 0;
  let finish;
  f.live.register('data', () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  await f.tick(); await f.tick(); f.emit('focus');
  assert.equal(calls, 1);
  finish(); await settle();
  await f.tick();
  assert.equal(calls, 2);
  finish();
});

test('pauses hidden, offline and cached pages and resumes on return', async () => {
  const f = fixture();
  let calls = 0;
  f.live.register('data', async () => { calls++; });
  f.document.visibilityState = 'hidden'; await f.tick();
  assert.equal(calls, 0);
  f.document.visibilityState = 'visible'; f.emit('visibilitychange'); await f.tick();
  assert.equal(calls, 1);
  f.navigator.onLine = false; await f.tick();
  assert.equal(calls, 1);
  f.navigator.onLine = true; f.emit('online'); await f.tick();
  assert.equal(calls, 2);
  f.emit('pagehide'); await f.tick();
  assert.equal(calls, 2);
  f.emit('pageshow'); await f.tick();
  assert.equal(calls, 3);
});

test('recovers after errors and disposes closed dialogs', async () => {
  const f = fixture();
  let calls = 0;
  const dispose = f.live.register('payment', async () => { calls++; throw new Error('Temporary outage'); });
  await f.tick(); await f.tick();
  assert.equal(calls, 2);
  dispose(); await f.tick();
  assert.equal(calls, 2);
});

test('keyed registrations replace old tasks without removing their replacements', async () => {
  const f = fixture();
  let old = 0;
  let current = 0;
  const dispose = f.live.register('data', async () => { old++; });
  f.live.register('data', async () => { current++; });
  dispose(); await f.tick();
  assert.equal(old, 0);
  assert.equal(current, 1);
});

test('typing, clicking, pointer movement, scrolling and touch postpone refresh until idle', async () => {
  const f = fixture();
  let calls = 0;
  f.live.register('data', async () => { calls++; });
  for (const event of ['pointermove', 'pointerdown', 'keydown', 'input', 'change', 'wheel', 'touchstart', 'touchmove']) {
    await f.advance(2000); f.emit(event);
    assert.equal(f.live.isIdle(), false);
    assert.equal(calls, 0);
  }
  await f.advance(2999); assert.equal(calls, 0);
  await f.advance(1); assert.equal(calls, 1);
  await f.tick(); assert.equal(calls, 2);
});

test('an interaction during an in-flight request makes its idle rendering guard fail', async () => {
  const f = fixture();
  let finish;
  let applied = false;
  f.live.register('data', async () => {
    await new Promise(resolve => { finish = resolve; });
    if (f.live.isIdle()) applied = true;
  });
  await f.tick(); f.emit('keydown'); finish(); await settle();
  assert.equal(applied, false);
});
