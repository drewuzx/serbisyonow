'use strict';

(function registerAnalyticsMotion() {
  if (window.snAnalyticsMotion) return;

  const counterSelector = [
    '.stats-grid .stat-info .value',
    '.metric-card h2',
    '.report-metric strong',
    '.admin-chart-row > strong',
    '.sn-chart-row > strong',
    '.sn-badge-component > strong',
  ].join(',');
  const chartSelectors = [
    '.sn-provider-chart-bars .sn-bar',
    '.admin-chart-fill',
    '.sn-chart-fill',
    '.report-bar-button > span',
  ];
  const activeCounters = new WeakMap();
  const activeProgress = new WeakMap();
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateCounter(element) {
    const raw = element.textContent.trim();
    if (!raw || reducedMotion() || element.dataset.snCounterFrame === raw
      || (element.dataset.snCounterValue === raw && !activeCounters.has(element))) return;
    const match = raw.match(/[+-]?[\d,]+(?:\.\d+)?/);
    if (!match) return;

    const target = Number(match[0].replaceAll(',', ''));
    if (!Number.isFinite(target)) return;
    const previous = activeCounters.get(element);
    if (previous) cancelAnimationFrame(previous);

    const prefix = raw.slice(0, match.index);
    const suffix = raw.slice(match.index + match[0].length);
    const decimals = (match[0].split('.')[1] || '').length;
    const formatter = new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const startedAt = performance.now();
    const duration = 750;
    element.dataset.snCounterValue = raw;

    const tick = (now) => {
      if (!element.isConnected || reducedMotion()) {
        element.textContent = raw;
        activeCounters.delete(element);
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      const frame = progress === 1 ? raw : `${prefix}${formatter.format(target * eased)}${suffix}`;
      element.dataset.snCounterFrame = frame;
      element.textContent = frame;
      if (progress < 1) activeCounters.set(element, requestAnimationFrame(tick));
      else activeCounters.delete(element);
    };

    const initialFrame = `${prefix}${formatter.format(0)}${suffix}`;
    element.dataset.snCounterFrame = initialFrame;
    element.textContent = initialFrame;
    activeCounters.set(element, requestAnimationFrame(tick));
  }

  function animateChartBar(element) {
    if (reducedMotion()) {
      element.classList.add('sn-motion-ready');
      return;
    }
    element.classList.remove('sn-motion-ready');
    requestAnimationFrame(() => {
      if (element.isConnected) element.classList.add('sn-motion-ready');
    });
  }

  function animateProgress(element) {
    const target = Math.max(0, Math.min(Number(element.max) || 1, Number(element.value) || 0));
    const key = `${target}/${Number(element.max) || 1}`;
    if (element.dataset.snProgressValue === key) return;
    const previous = activeProgress.get(element);
    if (previous) cancelAnimationFrame(previous);
    element.dataset.snProgressValue = key;
    if (reducedMotion()) {
      element.value = target;
      element.classList.add('sn-motion-ready');
      activeProgress.delete(element);
      return;
    }

    const duration = 750;
    const startedAt = performance.now();
    element.value = 0;
    const tick = (now) => {
      if (!element.isConnected || reducedMotion()) {
        element.value = target;
        activeProgress.delete(element);
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      element.value = target * eased;
      if (progress < 1) activeProgress.set(element, requestAnimationFrame(tick));
      else {
        element.value = target;
        element.classList.add('sn-motion-ready');
        activeProgress.delete(element);
      }
    };
    activeProgress.set(element, requestAnimationFrame(tick));
  }

  function scan(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    if (root.matches?.(counterSelector)) animateCounter(root);
    root.querySelectorAll?.(counterSelector).forEach(animateCounter);
    if (root.matches?.('progress')) animateProgress(root);
    root.querySelectorAll?.('progress').forEach(animateProgress);
    chartSelectors.forEach((selector) => {
      if (root.matches?.(selector)) animateChartBar(root);
      root.querySelectorAll?.(selector).forEach(animateChartBar);
    });
  }

  function start() {
    scan(document);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'characterData') scan(record.target.parentElement);
        else if (record.type === 'attributes') scan(record.target);
        else record.addedNodes.forEach((node) => scan(node.nodeType === Node.ELEMENT_NODE ? node : record.target));
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    window.snAnalyticsMotion = { refresh: () => scan(document) };
  }

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/shared/css/analytics-motion.css';
  style.onload = start;
  document.head.appendChild(style);
})();
