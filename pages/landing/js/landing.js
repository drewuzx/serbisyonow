'use strict';

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

function renderLandingServiceTags(category) {
  const tags = document.getElementById('landing-service-tags');
  if (!tags) return;

  const services = landingServicesByCategory[category] || landingServicesByCategory.repairServices;
  tags.innerHTML = services.map((service, index) => (
    `<button class="service-tag${index === 0 ? ' active' : ''}" type="button">${service}</button>`
  )).join('');

  tags.querySelectorAll('.service-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tags.querySelectorAll('.service-tag').forEach(item => item.classList.remove('active'));
      tag.classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const categoryCards = document.querySelectorAll('.service-cat-card[data-category]');
  categoryCards.forEach(card => {
    card.addEventListener('click', () => {
      categoryCards.forEach(item => {
        item.classList.remove('active');
        item.querySelector('.active-indicator')?.remove();
      });

      card.classList.add('active');
      if (!card.querySelector('.active-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'active-indicator';
        card.appendChild(indicator);
      }

      renderLandingServiceTags(card.dataset.category);
    });
  });

  renderLandingServiceTags(document.querySelector('.service-cat-card.active')?.dataset.category || 'repairServices');
});
