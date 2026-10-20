const PROVIDER_PROFILE_API = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

function ppEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ppMoney(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function ppBadge(provider) {
  const tier = provider.verified_tier;
  const style = tier === 'top' ? 'top' : tier === 'skilled' ? 'verified' : 'basic';
  return `<div class="sn-provider-badge sn-badge--${style}">${ppEsc(provider.badge_status || 'Pending Verification')}</div>`;
}

async function ppGet(path) {
  const response = await fetch(`${PROVIDER_PROFILE_API}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Unable to load provider profile.');
  return data;
}

function ppGetCleanAbout(provider) {
  if (typeof provider.description === 'string' && provider.description.trim()) return provider.description.trim();
  const rawAbout = provider.about || provider.experience || '';
  
  // If it looks like JSON (starts with { or [), try to extract or skip it
  if (String(rawAbout).trim().startsWith('{') || String(rawAbout).trim().startsWith('[')) {
    return `${provider.full_name || 'This service provider'} is a skilled and experienced professional dedicated to providing quality ${(provider.service || provider.category || 'services').toLowerCase()} with customer satisfaction as the top priority.`;
  }
  
  // If it's a long technical string, return default
  if (rawAbout.length > 500) {
    return `${provider.full_name || 'This service provider'} is a skilled and experienced professional dedicated to providing quality ${(provider.service || provider.category || 'services').toLowerCase()} with customer satisfaction as the top priority.`;
  }
  
  return rawAbout || `Experienced and dependable service professional committed to quality workmanship, timely service, and customer satisfaction.`;
}

function ppRenderProvider(provider) {
  const detail = document.querySelector('.sn-provider-detail');
  if (!detail) return;

  const startingRate = Number(provider.starting_price);
  const rating = provider.rating;
  const completedJobs = Number(provider.completed_jobs || 0);
  const reviewCount = Number(provider.review_count || 0);
  const experienceYears = provider.experience_years || 'Not provided';
  const serviceLabel = provider.service || provider.category || 'Home Service';
  const locationLabel = provider.address || 'Angeles City';
  const cleanAbout = ppGetCleanAbout(provider);

  const proofItems = [
    `Reported service experience: ${experienceYears}.`,
    `${completedJobs} completed services on SerbisyoNow.`,
  ];

  const credentials = [
    provider.badge_details?.documents_approved ? `${provider.badge_details.document_count} supporting documents approved by the admin.` : 'No approved supporting credentials yet.',
  ];

  detail.innerHTML = `
    <div class="sn-detail-panel">
      <div class="sn-detail-header">
        <div class="sn-profile-summary">
          <div class="sn-profile-photo" data-photo-target="provider/${Number(provider.id)}"></div>
          <div class="sn-profile-meta">
            <h2>${ppEsc(provider.full_name || 'Service Provider')}</h2>
            ${ppBadge(provider)}
            <p class="sn-profile-location">${ppEsc(locationLabel)} • ${ppEsc(serviceLabel)}</p>
          </div>
        </div>
        <div class="sn-rate-card">
          <span class="sn-rate-label">Starting Rate</span>
          <strong>${startingRate > 0 ? ppMoney(startingRate) : 'Price not set'}</strong>
        </div>
      </div>

      <div class="sn-profile-sections">
        <section class="sn-profile-section">
          <h3>ABOUT THE SERVICE PROVIDER</h3>
          <p>${ppEsc(cleanAbout)}</p>
        </section>

        <section class="sn-profile-section">
          <h3>PROOF OF EXP / WORK</h3>
          <ul class="sn-profile-list">
            ${proofItems.map((item) => `<li>${ppEsc(item)}</li>`).join('')}
          </ul>
        </section>

        <section class="sn-profile-section">
          <h3>Certifications / Licenses</h3>
          <ul class="sn-profile-list">
            ${credentials.map((item) => `<li>${ppEsc(item)}</li>`).join('')}
          </ul>
        </section>

        <section class="sn-profile-section">
          <h3>RATINGS</h3>
          <p class="sn-rating-line">${reviewCount ? `${Number(rating).toFixed(1)} out of 5 from ${reviewCount} completed-service reviews.` : 'No completed-service reviews yet.'}</p>
        </section>

      </div>
    </div>
    <aside class="sn-detail-panel">
      <h3>Availability</h3>
      <p>Schedule depends on provider availability and confirmed bookings.</p>
      <div class="sn-actions-row">
        <a class="btn btn-primary btn-full" href="../bookings/bookings.html?provider_id=${provider.id}">Book Service</a>
        <a class="btn btn-outline btn-full" href="../dashboard/dashboard.html#messages=${provider.id}" data-open-chat="${provider.id}">Message Provider</a>
      </div>
    </aside>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  await window.snAccountSessionReady;
  const providerId = new URLSearchParams(window.location.search).get('id');
  const detail = document.querySelector('.sn-provider-detail');

  if (!providerId) {
    if (detail) {
      detail.innerHTML = `
        <div class="sn-detail-panel">
          <h2>No provider selected</h2>
          <p>To view a provider's profile, search for a service and click "View Profile" on a provider card.</p>
          <a class="btn btn-primary" href="../search/search.html" style="display: inline-block; margin-top: 12px;">Go to Search</a>
        </div>
      `;
    }
    return;
  }

  let signature = '';
  const refreshProvider = async () => {
    const { user } = await ppGet(`/api/auth/provider/status/${providerId}`);
    if (!window.snLiveRefresh?.isIdle()) return;
    const next = JSON.stringify(user);
    if (next === signature) return;
    signature = next;
    ppRenderProvider(user);
  };
  window.snStartLiveRefresh('provider-profile', refreshProvider);
  try {
    const providerData = await ppGet(`/api/auth/provider/status/${providerId}`);
    signature = JSON.stringify(providerData.user);
    ppRenderProvider(providerData.user);
  } catch (error) {
    if (detail) {
      detail.innerHTML = `
        <div class="sn-detail-panel">
          <h2>Provider unavailable</h2>
          <p>${ppEsc(error.message)}</p>
          <a class="btn btn-outline" href="../search/search.html" style="display: inline-block; margin-top: 12px;">Back to Search</a>
        </div>
      `;
    }
  }
});
