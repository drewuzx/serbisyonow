'use strict';

const API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

function getCurrentCustomer() {
  try {
    return JSON.parse(localStorage.getItem('sn_customer_user') || 'null');
  } catch {
    return null;
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function categoryLabel(value) {
  const label = String(value || '').trim();
  const aliases = {
    'home repair': 'Repair Services',
    'home repairs': 'Repair Services',
    'home installation': 'Installation Services',
    'home installations': 'Installation Services',
  };
  return aliases[label.toLowerCase()] || label;
}

function providerBadge(provider) {
  const tier = provider.verified_tier || (provider.badge_status || '').toLowerCase();
  if (String(tier).includes('top')) return '<div class="sn-provider-badge sn-badge--top">Top-Tier Verified</div>';
  if (String(tier).includes('skilled')) return '<div class="sn-provider-badge sn-badge--verified">Skilled Verified</div>';
  return '<div class="sn-provider-badge sn-badge--basic">Basic Verified</div>';
}

async function saveCustomerFavorite(customerId, providerId) {
  const response = await fetch(`${API_BASE}/api/customer/${customerId}/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider_id: providerId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Unable to save favorite.');
  return data;
}

document.addEventListener('DOMContentLoaded', async () => {
  const currentCustomer = getCurrentCustomer();
  if (!currentCustomer) {
    window.location.href = '../../auth/customerLogin.html';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        Object.assign(currentCustomer, data.user);
        localStorage.setItem('sn_customer_user', JSON.stringify(currentCustomer));
      }
    }
  } catch {
    // Keep cached user data when the API is unavailable.
  }

  const status = currentCustomer.verification_status || 'pending';
  const userName = document.getElementById('sn-user-name');
  const userStatus = document.getElementById('sn-user-status');
  const verifyBanner = document.getElementById('sn-verify-banner');
  if (userName) userName.textContent = currentCustomer.full_name || 'Customer';
  if (userStatus) {
    userStatus.textContent = status === 'verified'
      ? 'Verified customer'
      : status === 'rejected'
        ? 'Verification declined'
        : 'Awaiting verification';
  }
  if (status !== 'verified') {
    document.body.classList.add('sn-locked');
    if (verifyBanner) {
      verifyBanner.hidden = false;
      verifyBanner.textContent = status === 'rejected'
        ? 'Your verification was declined by the admin. Please resubmit your documents.'
        : 'Your account is pending admin verification. Actions are disabled until verified.';
    }
  } else if (verifyBanner) {
    verifyBanner.hidden = true;
  }

  const shell = document.querySelector('.sn-shell');
  const overlay = document.getElementById('sn-overlay');
  const hamburger = document.getElementById('sn-hamburger');
  const hamburgerTop = document.getElementById('sn-hamburger-top');
  const logoutBtn = document.getElementById('sn-logout');

  function isMobile() {
    return window.matchMedia('(max-width: 940px)').matches;
  }
  function closeSidebar() {
    shell?.classList.remove('sidebar-open');
    shell?.classList.add('sidebar-collapsed');
    document.body.style.overflow = '';
  }
  function openSidebar() {
    shell?.classList.remove('sidebar-collapsed');
    shell?.classList.add('sidebar-open');
    if (isMobile()) document.body.style.overflow = 'hidden';
  }
  hamburger?.addEventListener('click', closeSidebar);
  hamburgerTop?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('sn_customer_user');
    window.location.href = '../../auth/customerLogin.html';
  });
  if (isMobile()) closeSidebar();
  else openSidebar();

  const topSearch = document.getElementById('sn-global-search');
  const pageSearch = document.getElementById('sn-page-search');
  const topFilterButton = document.querySelector('.sn-topbar-pill');
  const topbar = document.querySelector('.sn-topbar');
  const resultList = document.getElementById('sn-results-list');
  const countEl = document.getElementById('sn-results-count');
  const tabs = document.querySelectorAll('.sn-filter-tab');
  const sortLabels = {
    recommended: {
      title: 'Recommended',
      text: 'Based on nearest location match.',
    },
    top: {
      title: 'Top Verified',
      text: 'Based on assessment, supporting documents, and ratings.',
    },
    highest: {
      title: 'Highest Verified',
      text: 'Based on assessment and supporting documents.',
    },
    basic: {
      title: 'Basic Verified',
      text: 'Based on assessment and supporting documents.',
    },
    available: {
      title: 'Available First',
      text: 'Prioritizes providers with open availability slots.',
    },
  };
  const initialFilters = new URLSearchParams(window.location.search);
  let currentSort = initialFilters.get('sort') || 'recommended';
  let currentQuery = initialFilters.get('q') || topSearch?.value || '';
  let currentCategory = initialFilters.get('category') || '';
  let currentLocationQuery = initialFilters.get('location') || currentCustomer.address || '';
  let availableOnly = ['true', '1', 'yes', 'available'].includes(String(initialFilters.get('available') || '').toLowerCase());
  let deviceCoords = null;
  let searchMap = null;
  let searchMapLayer = null;
  let searchRouteLayer = null;
  let selectedRouteProviderId = null;
  let routeRequestId = 0;
  let mapRequestId = 0;
  if (topSearch) topSearch.value = currentQuery;
  if (pageSearch) pageSearch.value = currentQuery;
  if (topSearch && topSearch.closest('.sn-topbar-search')) {
    topSearch.closest('.sn-topbar-search').style.display = 'none';
  }

  const categories = ['All', 'Repair Services', 'Cleaning', 'Personal Care', 'Appliance Maintenance', 'Installation Services', 'Outdoor and Property Maintenance'];
  const sortPanel = document.createElement('div');
  sortPanel.className = 'sn-sort-summary';
  sortPanel.innerHTML = `
    <div>
      <strong id="sn-sort-title">Recommended</strong>
      <span id="sn-sort-description">Balances verification, service match, ratings, completed jobs, availability, and favorites.</span>
    </div>
    <button class="sn-sort-open" type="button">Change sorting</button>
  `;
  document.querySelector('.sn-filter-tabs')?.after(sortPanel);

  const topFilterPanel = document.createElement('section');
  topFilterPanel.className = 'sn-search-filter-panel sn-unlocked-control';
  topFilterPanel.hidden = true;
  topFilterPanel.innerHTML = `
    <div class="sn-filter-panel-grid">
      <label>
        <span>Service Category</span>
        <select id="sn-filter-category">
          ${categories.map((category, index) => `<option value="${index === 0 ? '' : esc(category)}">${esc(category)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Sort Results</span>
        <select id="sn-filter-sort">
          <option value="recommended">Recommended</option>
          <option value="top">Top Verified</option>
          <option value="highest">Highest Verified</option>
          <option value="basic">Basic Verified</option>
          <option value="available">Available First</option>
        </select>
      </label>
      <label>
        <span>Location</span>
        <input id="sn-filter-location" type="text" value="${esc(currentLocationQuery)}" placeholder="Enter city, barangay, or address" />
      </label>
      <label class="sn-filter-check">
        <input id="sn-filter-available-panel" type="checkbox" />
        <span>Show available providers only</span>
      </label>
    </div>
    <div class="sn-filter-panel-actions">
      <button class="sn-filter-action sn-filter-action--ghost" type="button" id="sn-filter-reset">Reset</button>
      <button class="sn-filter-action sn-filter-action--outline" type="button" id="sn-filter-gps">Use GPS Location</button>
      <button class="sn-filter-action sn-filter-action--primary" type="button" id="sn-filter-apply">Apply Filters</button>
    </div>
  `;
  topbar?.after(topFilterPanel);

  const categoryRow = document.createElement('div');
  categoryRow.className = 'sn-search-categories';
  categoryRow.innerHTML = categories.map((category, index) => `
    <button class="sn-search-chip ${(index === 0 ? '' : category) === currentCategory ? 'active' : ''}" type="button" data-category="${index === 0 ? '' : esc(category)}">${esc(category)}</button>
  `).join('') + '<label class="sn-available-toggle"><input type="checkbox" id="sn-available-only" /> Available only</label>';
  sortPanel.after(categoryRow);

  const mapPanel = document.createElement('section');
  mapPanel.className = 'sn-map-panel';
  mapPanel.innerHTML = `
    <div class="sn-map-head">
      <div>
        <h3>Nearby Provider Map</h3>
        <p id="sn-map-status">GPS gives the most accurate nearby results.</p>
      </div>
      <button class="sn-btn sn-btn-outline" type="button" id="sn-use-gps">Save My GPS</button>
    </div>
    <div class="sn-map-canvas" id="sn-map-canvas">
      <div class="sn-map-grid"></div>
      <p class="sn-search-empty">Loading map...</p>
    </div>
  `;
  categoryRow.after(mapPanel);
  const mapCanvas = document.getElementById('sn-map-canvas');
  const mapStatus = document.getElementById('sn-map-status');

  async function loadProviders() {
    if (!resultList) return;
    resultList.innerHTML = '<p class="sn-search-empty">Loading providers...</p>';
    try {
      const params = new URLSearchParams({
        q: currentQuery,
        category: currentCategory,
        sort: currentSort,
        available: String(availableOnly),
        customerId: currentCustomer.id,
        location: currentLocationQuery,
      });
      const res = await fetch(`${API_BASE}/api/customer/search/providers?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to load providers.');
      renderSortSummary(data.algorithm);
      renderProviders(data.providers || []);
      loadLocationMap();
    } catch (error) {
      resultList.innerHTML = `<p class="sn-search-empty">${esc(error.message || 'Failed to load providers.')}</p>`;
      if (countEl) countEl.textContent = '0 providers found';
    }
  }

  async function loadLocationMap() {
    if (!mapCanvas) return;
    const requestId = ++mapRequestId;
    const params = new URLSearchParams({
      q: currentQuery,
      category: currentCategory,
      location: currentLocationQuery,
      sort: currentSort,
    });
    if (deviceCoords) {
      params.set('lat', deviceCoords.lat);
      params.set('lng', deviceCoords.lng);
    }

    try {
      const res = await fetch(`${API_BASE}/api/customer/${currentCustomer.id}/location-map?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to load map.');
      if (requestId !== mapRequestId) return;
      renderLocationMap(data);
    } catch (error) {
      if (requestId !== mapRequestId) return;
      mapCanvas.innerHTML = `<div class="sn-map-grid"></div><p class="sn-search-empty">${esc(error.message || 'Map unavailable.')}</p>`;
    }
  }

  function mapPosition(point, bounds) {
    const x = ((point.lng - bounds.minLng) / Math.max(bounds.maxLng - bounds.minLng, 0.0001)) * 84 + 8;
    const y = 92 - ((point.lat - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, 0.0001)) * 84;
    return {
      left: Math.max(6, Math.min(94, x)),
      top: Math.max(6, Math.min(94, y)),
    };
  }

  function formatLocationAccuracy(provider) {
    const isAccurate = provider.location_accuracy === 'accurate';
    const offset = provider.location_accuracy_m ? ` +/- ${Math.round(provider.location_accuracy_m)}m` : '';
    return isAccurate ? `accurate GPS${offset}` : 'estimated';
  }

  function isValidMapPoint(point) {
    return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
  }

  function getProviderPoint(provider) {
    return {
      lat: Number(provider?.map_lat),
      lng: Number(provider?.map_lng),
    };
  }

  function routeDistanceLabel(meters) {
    const distance = Number(meters || 0);
    if (!distance) return '';
    return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
  }

  function routeDurationLabel(seconds) {
    const minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
    return `${minutes} min`;
  }

  function renderLocationMap(data) {
    const providers = [...(data.providers || [])].sort((a, b) => {
      const tierRank = { top: 3, skilled: 2, basic: 1 };
      if (currentSort === 'top') {
        return (tierRank[b.verified_tier] || 0) - (tierRank[a.verified_tier] || 0)
          || Number(b.assessment_score || 0) - Number(a.assessment_score || 0)
          || Number(b.rating || 0) - Number(a.rating || 0)
          || Number(a.distance_km || 0) - Number(b.distance_km || 0);
      }
      if (currentSort === 'highest') {
        return Number(b.assessment_score || 0) - Number(a.assessment_score || 0)
          || Number(b.rating || 0) - Number(a.rating || 0)
          || Number(a.distance_km || 0) - Number(b.distance_km || 0);
      }
      if (currentSort === 'basic') {
        return Number(a.assessment_score || 0) - Number(b.assessment_score || 0)
          || Number(b.rating || 0) - Number(a.rating || 0)
          || Number(a.distance_km || 0) - Number(b.distance_km || 0);
      }
      return Number(a.distance_km || 0) - Number(b.distance_km || 0)
        || Number(b.rating || 0) - Number(a.rating || 0);
    });
    const customer = data.customer_location;
    if (mapStatus) {
      if (customer?.source === 'device-gps') {
        mapStatus.textContent = 'Using live device GPS. This is the most accurate customer location.';
      } else if (customer?.source === 'saved-gps') {
        mapStatus.textContent = 'Using your saved GPS location. Provider pins marked accurate have saved GPS too.';
      } else {
        mapStatus.textContent = 'Using an estimated address location. Click Save My GPS for accurate matching.';
      }
    }
    if (!customer || !providers.length) {
      mapCanvas.innerHTML = '<div class="sn-map-grid"></div><p class="sn-search-empty">No nearby providers to map.</p>';
      return;
    }

    if (window.L) {
      renderLeafletMap(customer, providers);
      return;
    }

    const points = [
      { lat: customer.lat, lng: customer.lng },
      ...providers.map((provider) => ({ lat: provider.map_lat, lng: provider.map_lng })),
    ];
    const bounds = {
      minLat: Math.min(...points.map((p) => p.lat)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      minLng: Math.min(...points.map((p) => p.lng)),
      maxLng: Math.max(...points.map((p) => p.lng)),
    };
    const customerPos = mapPosition(customer, bounds);
    const nearest = providers.slice(0, 4);
    const selectedProvider = nearest.find((provider) => String(provider.id) === String(selectedRouteProviderId)) || nearest[0];
    selectedRouteProviderId = selectedProvider?.id || null;
    const selectedPos = selectedProvider ? mapPosition({ lat: selectedProvider.map_lat, lng: selectedProvider.map_lng }, bounds) : null;

    mapCanvas.innerHTML = `
      <div class="sn-map-grid"></div>
      ${selectedPos ? `
        <svg class="sn-static-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M ${customerPos.left} ${customerPos.top} C ${customerPos.left + 10} ${customerPos.top - 20}, ${selectedPos.left - 10} ${selectedPos.top + 20}, ${selectedPos.left} ${selectedPos.top}" />
        </svg>
      ` : ''}
      <div class="sn-map-pin sn-map-pin--customer" style="left:${customerPos.left}%;top:${customerPos.top}%;">
        <span>You</span>
      </div>
      ${nearest.map((provider, index) => {
        const pos = mapPosition({ lat: provider.map_lat, lng: provider.map_lng }, bounds);
        return `
          <button class="sn-map-pin sn-map-pin--provider ${String(provider.id) === String(selectedRouteProviderId) ? 'is-selected' : ''}" type="button" style="left:${pos.left}%;top:${pos.top}%;" title="${esc(provider.full_name)}">
            <span>${index + 1}</span>
          </button>
        `;
      }).join('')}
      <div class="sn-map-nearby-list">
        ${nearest.map((provider, index) => `
          <div class="sn-map-nearby-item">
            <strong>${index + 1}. ${esc(provider.full_name)}</strong>
            <span>${Number(provider.distance_km || 0).toFixed(1)} km - ${esc(provider.location_match || 'nearby')}</span>
            <em class="${provider.location_accuracy === 'accurate' ? 'sn-location-accurate' : 'sn-location-estimated'}">${formatLocationAccuracy(provider)}</em>
          </div>
        `).join('')}
      </div>
    `;
  }

  function makeLeafletIcon(type, label, accurate = true, selected = false) {
    return window.L.divIcon({
      className: '',
      html: `<div class="sn-map-marker sn-map-marker--${type} ${accurate ? 'is-accurate' : 'is-estimated'} ${selected ? 'is-selected' : ''}"><span>${esc(label)}</span></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 42],
      popupAnchor: [0, -36],
    });
  }

  function renderLeafletMap(customer, providers) {
    const nearest = providers.slice(0, 8).filter((provider) => isValidMapPoint(getProviderPoint(provider)));
    const selectedProvider = nearest.find((provider) => String(provider.id) === String(selectedRouteProviderId)) || nearest[0];
    selectedRouteProviderId = selectedProvider?.id || null;
    mapCanvas.innerHTML = `
      <div class="sn-map-toolbar">
        <span>${customer.source === 'device-gps' ? 'Live GPS' : customer.source === 'saved-gps' ? 'Saved GPS' : 'Estimated address'}</span>
        <strong id="sn-route-summary">${selectedProvider ? `Route to ${esc(selectedProvider.full_name)}` : `${nearest.length} nearby`}</strong>
      </div>
      <div class="sn-real-map" id="sn-real-map"></div>
      <div class="sn-map-nearby-list sn-map-nearby-list--leaflet">
        ${nearest.slice(0, 4).map((provider, index) => `
          <button class="sn-map-nearby-item ${String(provider.id) === String(selectedRouteProviderId) ? 'is-selected' : ''}" type="button" data-route-provider="${esc(provider.id)}">
            <strong>${index + 1}. ${esc(provider.full_name)}</strong>
            <span>${Number(provider.distance_km || 0).toFixed(1)} km - ${esc(provider.location_match || 'nearby')}</span>
            <em class="${provider.location_accuracy === 'accurate' ? 'sn-location-accurate' : 'sn-location-estimated'}">${formatLocationAccuracy(provider)}</em>
          </button>
        `).join('')}
      </div>
    `;

    if (searchMap) {
      searchMap.remove();
      searchMap = null;
      searchMapLayer = null;
      searchRouteLayer = null;
    }

    searchMap = window.L.map('sn-real-map', {
      zoomControl: false,
      scrollWheelZoom: true,
    }).setView([customer.lat, customer.lng], 14);

    window.L.control.zoom({ position: 'bottomleft' }).addTo(searchMap);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(searchMap);

    searchMapLayer = window.L.featureGroup().addTo(searchMap);
    searchRouteLayer = window.L.layerGroup().addTo(searchMap);
    window.L.marker([customer.lat, customer.lng], {
      icon: makeLeafletIcon('customer', 'You', true),
    }).bindPopup(`<strong>Your location</strong><br>${esc(customer.address || 'GPS location')}<br>${esc(customer.source || 'gps')}`).addTo(searchMapLayer);

    nearest.forEach((provider, index) => {
      const accurate = provider.location_accuracy === 'accurate';
      const selected = String(provider.id) === String(selectedRouteProviderId);
      const marker = window.L.marker([provider.map_lat, provider.map_lng], {
        icon: makeLeafletIcon('provider', index + 1, accurate, selected),
      }).bindPopup(`
        <strong>${esc(provider.full_name)}</strong><br>
        ${esc(provider.service || categoryLabel(provider.category) || 'Service provider')}<br>
        ${Number(provider.distance_km || 0).toFixed(1)} km away<br>
        ${accurate ? `Accurate GPS saved${provider.location_accuracy_m ? ` (+/- ${Math.round(provider.location_accuracy_m)}m)` : ''}` : 'Estimated from address'}
      `).addTo(searchMapLayer);

      marker.getElement()?.querySelector('.sn-map-marker')?.setAttribute('data-route-provider', String(provider.id));
      marker.on('click', () => selectRouteProvider(customer, nearest, provider.id));
    });

    mapCanvas.querySelectorAll('[data-route-provider]').forEach((item) => {
      item.addEventListener('click', () => selectRouteProvider(customer, nearest, item.dataset.routeProvider));
    });

    drawRouteToProvider(customer, selectedProvider, nearest);

    const bounds = searchMapLayer.getBounds();
    if (bounds.isValid()) searchMap.fitBounds(bounds.pad(0.24), { maxZoom: 15 });
    setTimeout(() => searchMap?.invalidateSize(), 100);
  }

  function selectRouteProvider(customer, providers, providerId) {
    const provider = providers.find((item) => String(item.id) === String(providerId));
    if (!provider) return;
    selectedRouteProviderId = provider.id;
    mapCanvas.querySelectorAll('[data-route-provider]').forEach((item) => {
      item.classList.toggle('is-selected', String(item.dataset.routeProvider) === String(provider.id));
    });
    mapCanvas.querySelectorAll('.sn-map-marker[data-route-provider]').forEach((marker) => {
      marker.classList.toggle('is-selected', String(marker.dataset.routeProvider) === String(provider.id));
    });
    drawRouteToProvider(customer, provider, providers);
  }

  async function drawRouteToProvider(customer, provider, providers = []) {
    if (!searchMap || !searchRouteLayer || !provider) return;
    const customerPoint = { lat: Number(customer.lat), lng: Number(customer.lng) };
    const providerPoint = getProviderPoint(provider);
    if (!isValidMapPoint(customerPoint) || !isValidMapPoint(providerPoint)) return;

    const currentRequestId = ++routeRequestId;
    const routeSummary = document.getElementById('sn-route-summary');
    if (routeSummary) routeSummary.textContent = `Finding road route to ${provider.full_name || 'provider'}...`;
    searchRouteLayer.clearLayers();

    const directRoute = window.L.polyline([customerPoint, providerPoint], {
      color: '#2563eb',
      weight: 9,
      opacity: 0.82,
      dashArray: '10 12',
      lineCap: 'round',
    }).addTo(searchRouteLayer);

    try {
      const coordinates = `${customerPoint.lng},${customerPoint.lat};${providerPoint.lng},${providerPoint.lat}`;
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`);
      const data = await res.json().catch(() => ({}));
      if (currentRequestId !== routeRequestId) return;
      const route = data.routes?.[0];
      if (!res.ok || !route?.geometry?.coordinates?.length) throw new Error('Route unavailable');

      searchRouteLayer.removeLayer(directRoute);
      const routePoints = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const routeLine = window.L.polyline(routePoints, {
        color: '#2563eb',
        weight: 10,
        opacity: 0.94,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(searchRouteLayer);
      window.L.polyline(routePoints, {
        color: '#1d4ed8',
        weight: 4,
        opacity: 0.36,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(searchRouteLayer);

      const routeBounds = window.L.featureGroup([searchMapLayer, routeLine]).getBounds();
      if (routeBounds.isValid()) searchMap.fitBounds(routeBounds.pad(0.22), { maxZoom: 16 });
      if (routeSummary) {
        routeSummary.textContent = `${routeDurationLabel(route.duration)} - ${routeDistanceLabel(route.distance)} to ${provider.full_name || 'provider'}`;
      }
    } catch {
      if (currentRequestId !== routeRequestId) return;
      const bounds = window.L.featureGroup([searchMapLayer, directRoute]).getBounds();
      if (bounds.isValid()) searchMap.fitBounds(bounds.pad(0.22), { maxZoom: 15 });
      if (routeSummary) {
        routeSummary.textContent = `${Number(provider.distance_km || 0).toFixed(1)} km straight-line estimate to ${provider.full_name || 'provider'}`;
      }
    }
  }

  function renderProviders(providers) {
    if (countEl) {
      countEl.textContent = `${providers.length} provider${providers.length === 1 ? '' : 's'} found`;
    }

    if (!providers.length) {
      resultList.innerHTML = '<p class="sn-search-empty">No providers matched your search and filters.</p>';
      return;
    }

    resultList.innerHTML = providers.map((provider, index) => `
      <article class="sn-result-card">
        <div class="sn-result-img sn-result-img--${(index % 5) + 1}"></div>
        <div class="sn-result-body">
          <div class="sn-result-top">
            <span class="sn-result-name">${esc(provider.full_name)}</span>
            <div class="sn-result-price-wrap">
              <span class="sn-result-price">Starts at <strong>${money(provider.starting_price)}</strong></span>
              <span class="sn-result-price-note">*Price may vary</span>
              <button class="sn-fav-btn" type="button" data-provider-id="${provider.id}" aria-label="Favorite provider">♥</button>
            </div>
          </div>
          ${providerBadge(provider)}
          <div class="sn-result-rating">Rating ${Number(provider.rating || 0).toFixed(1)} - ${Number(provider.completed_jobs || 0)} completed jobs - ${Number(provider.available_slots || 0)} open slots</div>
          <div class="sn-ranking-signals">
            <span>Rank #${index + 1}</span>
            <span>${esc(sortLabels[currentSort]?.title || 'Recommended')}</span>
            <span>${Number(provider.recommendation_score || 0).toFixed(0)} score</span>
            <span>${provider.proximity_score >= 3 ? 'Location match' : provider.proximity_score >= 2 ? 'Nearby match' : 'Service match'}</span>
          </div>
          <p class="sn-result-desc">${esc(provider.service || categoryLabel(provider.category) || 'Home service')} near ${esc(provider.address || 'Angeles City')}.</p>
          <div class="sn-result-loc">${esc(provider.address || 'Location unavailable')}</div>
        </div>
        <div class="sn-result-actions">
          <a class="sn-btn sn-btn-outline" href="../provider-profile/provider-profile.html?id=${provider.id}">View Profile</a>
          <a class="sn-btn sn-btn-primary" href="../bookings/bookings.html?provider_id=${provider.id}">Book Now</a>
        </div>
      </article>
    `).join('');
  }

  resultList?.addEventListener('click', async (event) => {
    const favoriteButton = event.target.closest('.sn-fav-btn[data-provider-id]');
    if (!favoriteButton) return;
    event.preventDefault();
    favoriteButton.disabled = true;
    try {
      await saveCustomerFavorite(currentCustomer.id, favoriteButton.dataset.providerId);
      favoriteButton.classList.add('sn-fav-btn--active');
      favoriteButton.setAttribute('aria-label', 'Saved to favorites');
    } catch (error) {
      console.warn(error.message || error);
      favoriteButton.disabled = false;
    }
  });

  function renderSortSummary(algorithm = {}) {
    const active = sortLabels[currentSort] || sortLabels.recommended;
    const title = document.getElementById('sn-sort-title');
    const description = document.getElementById('sn-sort-description');
    if (title) title.textContent = active.title;
    if (description) {
      description.textContent = `${active.text} ${algorithm.search_filtering || 'Filters by service text, category, verification, and availability.'}`;
    }
  }

  let searchTimer;
  function applySearchQuery(value) {
    currentQuery = value.trim();
    if (topSearch) topSearch.value = currentQuery;
    if (pageSearch) pageSearch.value = currentQuery;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadProviders, 300);
  }
  topSearch?.addEventListener('input', () => applySearchQuery(topSearch.value));
  pageSearch?.addEventListener('input', () => applySearchQuery(pageSearch.value));

  function syncFilterControls() {
    const categorySelect = document.getElementById('sn-filter-category');
    const sortSelect = document.getElementById('sn-filter-sort');
    const locationInput = document.getElementById('sn-filter-location');
    const availablePanel = document.getElementById('sn-filter-available-panel');
    const availableInline = document.getElementById('sn-available-only');

    if (categorySelect) categorySelect.value = currentCategory;
    if (sortSelect) sortSelect.value = currentSort;
    if (locationInput) locationInput.value = currentLocationQuery;
    if (availablePanel) availablePanel.checked = availableOnly;
    if (availableInline) availableInline.checked = availableOnly;
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.sort === currentSort));
    categoryRow.querySelectorAll('.sn-search-chip').forEach((chip) => {
      chip.classList.toggle('active', (chip.dataset.category || '') === currentCategory);
    });
  }

  function applySort(sort) {
    currentSort = sort || 'recommended';
    syncFilterControls();
    loadProviders();
  }

  sortPanel.querySelector('.sn-sort-open')?.addEventListener('click', () => {
    topFilterPanel.hidden = false;
    topFilterButton?.setAttribute('aria-expanded', 'true');
    syncFilterControls();
  });

  if (topFilterButton) {
    topFilterButton.id = 'sn-topbar-filter';
    topFilterButton.type = 'button';
    topFilterButton.setAttribute('aria-controls', 'sn-search-filter-panel');
    topFilterButton.setAttribute('aria-expanded', 'false');
  }
  topFilterPanel.id = 'sn-search-filter-panel';

  function toggleTopFilterPanel() {
    const isOpen = topFilterPanel.hidden;
    topFilterPanel.hidden = !isOpen;
    topFilterButton?.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) syncFilterControls();
  }

  topFilterButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleTopFilterPanel();
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#sn-topbar-filter') || event.target.closest('.sn-sort-open')) {
      event.preventDefault();
      if (event.target.closest('#sn-topbar-filter')) toggleTopFilterPanel();
      return;
    }
    if (!topFilterPanel.hidden && !event.target.closest('#sn-search-filter-panel') && !event.target.closest('.sn-topbar-pill')) {
      topFilterPanel.hidden = true;
      topFilterButton?.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('sn-filter-apply')?.addEventListener('click', () => {
    const categorySelect = document.getElementById('sn-filter-category');
    const sortSelect = document.getElementById('sn-filter-sort');
    const locationInput = document.getElementById('sn-filter-location');
    const availablePanel = document.getElementById('sn-filter-available-panel');

    currentCategory = categorySelect?.value || '';
    currentSort = sortSelect?.value || 'recommended';
    currentLocationQuery = locationInput?.value.trim() || currentCustomer.address || '';
    availableOnly = Boolean(availablePanel?.checked);
    topFilterPanel.hidden = true;
    topFilterButton?.setAttribute('aria-expanded', 'false');
    syncFilterControls();
    loadProviders();
  });

  document.getElementById('sn-filter-sort')?.addEventListener('change', (event) => {
    applySort(event.target.value);
    topFilterPanel.hidden = true;
    topFilterButton?.setAttribute('aria-expanded', 'false');
  });

  document.getElementById('sn-filter-reset')?.addEventListener('click', () => {
    currentCategory = '';
    currentSort = 'recommended';
    currentLocationQuery = currentCustomer.address || '';
    availableOnly = false;
    deviceCoords = null;
    syncFilterControls();
    loadProviders();
  });

  document.getElementById('sn-use-gps')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      if (mapStatus) mapStatus.textContent = 'GPS is not available in this browser.';
      return;
    }
    if (mapStatus) mapStatus.textContent = 'Requesting GPS permission...';
    navigator.geolocation.getCurrentPosition((position) => {
      deviceCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      fetch(`${API_BASE}/api/customer/${currentCustomer.id}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: deviceCoords.lat, longitude: deviceCoords.lng, accuracy: deviceCoords.accuracy }),
      }).then((res) => res.json().catch(() => ({}))).then((data) => {
        if (data.user) {
          Object.assign(currentCustomer, data.user);
          localStorage.setItem('sn_customer_user', JSON.stringify(currentCustomer));
        }
      }).catch(() => {
        // Still use the live GPS point for this page even if saving fails.
      }).finally(loadLocationMap);
    }, () => {
      if (mapStatus) mapStatus.textContent = 'GPS permission was denied. Using registered address instead.';
      deviceCoords = null;
      loadLocationMap();
    }, { enableHighAccuracy: true, timeout: 8000 });
  });

  document.getElementById('sn-filter-gps')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      const locationInput = document.getElementById('sn-filter-location');
      if (locationInput) locationInput.value = currentCustomer.address || '';
      return;
    }
    if (mapStatus) mapStatus.textContent = 'Requesting GPS permission for filter accuracy...';
    navigator.geolocation.getCurrentPosition((position) => {
      deviceCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      currentLocationQuery = currentCustomer.address || 'Device GPS';
      const locationInput = document.getElementById('sn-filter-location');
      if (locationInput) locationInput.value = currentLocationQuery;
      fetch(`${API_BASE}/api/customer/${currentCustomer.id}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: deviceCoords.lat, longitude: deviceCoords.lng, accuracy: deviceCoords.accuracy }),
      }).catch(() => {});
      loadLocationMap();
    }, () => {
      if (mapStatus) mapStatus.textContent = 'GPS permission was denied. Location filter still uses typed address.';
    }, { enableHighAccuracy: true, timeout: 8000 });
  });

  tabs.forEach((tab) => {
    const label = tab.textContent.trim().toLowerCase();
    tab.dataset.sort = label.includes('basic')
      ? 'basic'
      : label.includes('highest')
        ? 'highest'
        : label.includes('top')
          ? 'top'
          : 'recommended';
    const meta = sortLabels[tab.dataset.sort] || sortLabels.recommended;
    tab.innerHTML = `<strong>${esc(meta.title)}</strong><span>${esc(meta.text)}</span>`;
    tab.classList.toggle('active', tab.dataset.sort === currentSort);
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      applySort(tab.dataset.sort);
    });
  });

  categoryRow.querySelectorAll('.sn-search-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryRow.querySelectorAll('.sn-search-chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.category || '';
      syncFilterControls();
      loadProviders();
    });
  });
  categoryRow.querySelector('#sn-available-only')?.addEventListener('change', (event) => {
    availableOnly = event.target.checked;
    syncFilterControls();
    loadProviders();
  });

  syncFilterControls();
  await loadProviders();
});
