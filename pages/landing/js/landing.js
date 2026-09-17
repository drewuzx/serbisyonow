'use strict';

const SERVICE_LOGIN_URL = '../auth/loginChoice.html?from=service';
const CUSTOMER_AFTER_LOGIN_KEY = 'sn_customer_after_login';

const landingServicesByCategory = {
  repairServices: [
    'Plumbing services',
    'Electrical repair',
    'Appliance repair',
    'Carpentry',
    'Roof repair',
    'Furniture repair',
    'Painting services',
    'Door and window repair',
  ],
  cleaning: [
    'General house cleaning',
    'Deep cleaning',
    'Bathroom cleaning',
    'Kitchen cleaning',
    'Sofa and upholstery cleaning',
    'Carpet cleaning',
    'Window cleaning',
    'Laundry Services',
  ],
  personalCare: [
    'Massage therapy',
    'Home spa services',
    'Haircut',
    'Nail Care',
    'Eyelash Care',
    'Grooming',
  ],
  applianceMaintenance: [
    'Aircon',
    'Refrigerator',
    'Washing Machine',
    'Microwave',
    'TV / Electronics',
    'Small Appliances',
  ],
  installationServices: [
    'Furniture assembly',
    'Cabinet installation',
    'Curtain or blinds installation',
    'Lighting installation',
    'CCTV installation',
    'Internet or router setup',
    'Appliance Installation',
  ],
  outdoorMaintenance: [
    'Gardening services',
    'Lawn mowing',
    'Landscape maintenance',
    'Tree trimming',
    'Fence repair',
  ],
};

function getStoredCustomer() {
  try {
    return JSON.parse(localStorage.getItem('sn_customer_user') || 'null');
  } catch {
    return null;
  }
}

function buildCustomerSearchUrl({ query = '', category = '' } = {}) {
  const params = new URLSearchParams();
  const cleanQuery = String(query || '').trim();
  const cleanCategory = String(category || '').trim();
  if (cleanQuery) params.set('q', cleanQuery);
  if (cleanCategory) params.set('category', cleanCategory);
  const search = params.toString();
  return `../customer/search/search.html${search ? `?${search}` : ''}`;
}

function rememberCustomerSearch(url) {
  try {
    sessionStorage.setItem(CUSTOMER_AFTER_LOGIN_KEY, url);
  } catch {
    // Session storage can be unavailable in strict/private browsing.
  }
}

function redirectToLoginWithSearch({ query = '', category = '', from = 'search' } = {}) {
  const target = buildCustomerSearchUrl({ query, category });
  const customer = getStoredCustomer();
  if (customer?.id) {
    window.location.href = target;
    return;
  }

  rememberCustomerSearch(target);
  const params = new URLSearchParams({ from });
  if (query) params.set('q', query);
  if (category) params.set('category', category);
  window.location.href = `../auth/loginChoice.html?${params}`;
}

function redirectToServiceLogin() {
  window.location.href = SERVICE_LOGIN_URL;
}

function serviceLoginUrl(service) {
  const params = new URLSearchParams({ from: 'service' });
  if (service) params.set('q', service);
  return `../auth/loginChoice.html?${params}`;
}

function renderLandingServiceTags(category) {
  const tags = document.getElementById('landing-service-tags');
  if (!tags) return;

  const services = landingServicesByCategory[category] || landingServicesByCategory.repairServices;
  tags.innerHTML = services.map((service, index) => (
    `<a class="service-tag${index === 0 ? ' active' : ''}" href="${serviceLoginUrl(service)}">${service}</a>`
  )).join('');

  tags.querySelectorAll('.service-tag').forEach(tag => {
    tag.addEventListener('click', event => {
      event.preventDefault();
      redirectToLoginWithSearch({ query: tag.textContent.trim(), from: 'service' });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const categoryCards = document.querySelectorAll('.service-cat-card[data-category]');
  categoryCards.forEach(card => {
    card.addEventListener('click', () => {
      redirectToServiceLogin();
    });
  });

  const heroSearchInput = document.querySelector('.hero-search input');
  const heroSearchButton = document.querySelector('.hero-search-btn');

  heroSearchButton?.addEventListener('click', () => {
    redirectToLoginWithSearch({ query: heroSearchInput?.value || '', from: 'search' });
  });
  heroSearchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      redirectToLoginWithSearch({ query: heroSearchInput.value, from: 'search' });
    }
  });

  renderLandingServiceTags(document.querySelector('.service-cat-card.active')?.dataset.category || 'repairServices');
});
