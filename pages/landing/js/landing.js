'use strict';

const landingServicesByCategory = {
  homeRepair: [
    'Plumbing',
    'Electrical',
    'Carpentry',
    'Roof Repair',
    'Furniture Repair',
    'Painting Services',
    'Door and Window Repair',
  ],
  cleaning: [
    'House Cleaning',
    'Deep Cleaning',
    'Laundry Service',
    'Drain Cleaning',
    'Move-in / Move-out Cleaning',
  ],
  personalCare: [
    'Massage Therapy',
    'Nail Care',
    'Haircut and Grooming',
    'Home Wellness Care',
  ],
  applianceMaintenance: [
    'Refrigerator Repair',
    'Aircon Cleaning',
    'Washing Machine Repair',
    'Small Appliance Repair',
    'Appliance Installation',
  ],
  homeInstallation: [
    'Pipe Installation',
    'Light Fixture Installation',
    'Shelf Installation',
    'Curtain and Blinds Installation',
    'General Fixture Installation',
  ],
  outdoorMaintenance: [
    'Grass Cutting',
    'Garden Cleanup',
    'Gutter Cleaning',
    'Outdoor Repair',
    'Property Maintenance',
  ],
};

function renderLandingServiceTags(category) {
  const tags = document.getElementById('landing-service-tags');
  if (!tags) return;

  const services = landingServicesByCategory[category] || landingServicesByCategory.homeRepair;
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

  renderLandingServiceTags(document.querySelector('.service-cat-card.active')?.dataset.category || 'homeRepair');
});
