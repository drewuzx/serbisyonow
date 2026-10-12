'use strict';

(function () {
  const tasks = new Map();
  const intervalMs = 3000;
  let suspended = false;
  let lastActivity = Date.now();
  let idleTimer;
  const available = () => !suspended && document.visibilityState === 'visible' && navigator.onLine !== false;
  const isIdle = () => available() && Date.now() - lastActivity >= intervalMs;

  async function run(task) {
    if (!isIdle() || task.running || tasks.get(task.key) !== task) return;
    task.running = true;
    try { await task.refresh(); }
    catch (error) { console.warn('Live refresh unavailable:', error.message || error); }
    finally { task.running = false; }
  }

  function register(key, refresh) {
    window.clearTimeout(tasks.get(key)?.timer);
    const task = { key, refresh, running: false, lastStarted: Date.now() };
    const refreshTask = () => {
      if (tasks.get(key) !== task) return;
      window.clearTimeout(task.timer);
      if (isIdle() && !task.running && Date.now() - task.lastStarted >= intervalMs) {
        task.lastStarted = Date.now();
        run(task);
      }
      task.timer = window.setTimeout(refreshTask, intervalMs);
    };
    task.timer = window.setTimeout(refreshTask, intervalMs);
    task.resume = () => { if (Date.now() - task.lastStarted >= intervalMs) refreshTask(); };
    tasks.set(key, task);
    return () => {
      window.clearTimeout(task.timer);
      if (tasks.get(key) === task) tasks.delete(key);
    };
  }

  const refreshAll = () => { for (const task of tasks.values()) task.resume(); };
  function activity() {
    lastActivity = Date.now();
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(refreshAll, intervalMs);
  }
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'input', 'change', 'wheel', 'touchstart', 'touchmove']) {
    document.addEventListener(event, activity, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', activity);
  window.addEventListener('focus', activity);
  window.addEventListener('online', activity);
  window.addEventListener('pagehide', () => { suspended = true; });
  window.addEventListener('pageshow', () => { suspended = false; activity(); });
  window.snLiveRefresh = { register, intervalMs, isIdle };
})();
