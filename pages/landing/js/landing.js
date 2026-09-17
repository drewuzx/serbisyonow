'use strict';

const SERVICE_LOGIN_URL = '../auth/loginChoice.html?from=service';

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

function redirectToServiceLogin() {
  window.location.href = SERVICE_LOGIN_URL;
}

function renderLandingServiceTags(category) {
  const tags = document.getElementById('landing-service-tags');
  if (!tags) return;

  const services = landingServicesByCategory[category] || landingServicesByCategory.repairServices;
  tags.innerHTML = services.map((service, index) => (
    `<a class="service-tag${index === 0 ? ' active' : ''}" href="${SERVICE_LOGIN_URL}">${service}</a>`
  )).join('');
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

  heroSearchButton?.addEventListener('click', redirectToServiceLogin);
  heroSearchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') redirectToServiceLogin();
  });

  renderLandingServiceTags(document.querySelector('.service-cat-card.active')?.dataset.category || 'repairServices');
});
