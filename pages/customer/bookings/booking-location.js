'use strict';

window.SNBookingLocation = {
 create(customer) {
  const host = document.getElementById('sn-booking-location-map');
  const status = document.getElementById('sn-booking-location-status');
  const summary = document.getElementById('sn-booking-gps-status');
  const confirm = document.getElementById('sn-confirm-booking-location');
  const gps = document.getElementById('sn-use-booking-gps');
  const center = document.getElementById('sn-booking-pin-center');
  const address = document.querySelector('#sn-create-booking-form [name="address"]');
  const landmark = document.getElementById('sn-booking-landmark');
  let point = null, confirmed = false, map = null, marker = null, revision = 0, disposed = false;
  const valid = (value, limit) => value !== null && value !== undefined && String(value).trim() !== ''
   && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
  const invalidate = () => {
   confirmed = false;
   revision++;
   summary.textContent = 'Location confirmation required';
   confirm.textContent = 'Confirm location';
  };
  const describe = () => {
   status.textContent = point
    ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}${point.accuracy != null ? ` (+/- ${Math.round(point.accuracy)} m)` : ''}`
    : 'No service pin selected';
  };
  const select = (latitude, longitude, accuracy = null) => {
   if (disposed || !valid(latitude, 90) || !valid(longitude, 180)) return;
   point = { latitude: Number(latitude), longitude: Number(longitude), accuracy };
   invalidate();
   if (!marker) {
    marker = L.marker([point.latitude, point.longitude], {
     draggable: true, title: 'Service location', alt: 'Service location pin',
     icon: L.divIcon({ className: 'sn-booking-pin', html: '<img src="/shared/icons/lucide/map-pin.svg" alt="" />', iconSize: [36, 44], iconAnchor: [18, 44] }),
    }).addTo(map);
    marker.on('dragstart', invalidate);
    marker.on('dragend', () => { const p = marker.getLatLng(); select(p.lat, p.lng); });
   } else marker.setLatLng([point.latitude, point.longitude]);
   confirm.disabled = false;
   describe();
  };
  address.addEventListener('input', () => { invalidate(); describe(); });
  landmark.addEventListener('input', invalidate);
  if (!window.L) {
   status.textContent = 'Map unavailable. Refresh the page to retry.';
   gps.disabled = center.disabled = confirm.disabled = true;
  } else {
   const saved = valid(customer.latitude, 90) && valid(customer.longitude, 180);
   map = L.map(host, { dragging: true, touchZoom: true, scrollWheelZoom: false })
    .setView(saved ? [Number(customer.latitude), Number(customer.longitude)] : [15.145, 120.59], saved ? 17 : 13);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
   }).addTo(map).on('tileerror', () => { status.textContent = 'Some map tiles could not load. Check your connection before confirming the pin.'; });
   map.on('click', event => select(event.latlng.lat, event.latlng.lng));
   if (saved) select(customer.latitude, customer.longitude);
   center.addEventListener('click', () => { const p = map.getCenter(); select(p.lat, p.lng); });
   gps.addEventListener('click', () => {
    if (!navigator.geolocation) { status.textContent = 'Device location unavailable. Select a location on the map.'; return; }
    invalidate();
    const requestRevision = revision;
    gps.disabled = true;
    status.textContent = 'Requesting current location...';
    navigator.geolocation.getCurrentPosition(position => {
     if (disposed) return;
     gps.disabled = false;
     // A delayed GPS result must not replace a pin the customer has since moved.
     if (requestRevision !== revision) return;
     select(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
     map.setView([point.latitude, point.longitude], 17);
    }, () => {
     if (disposed) return;
     gps.disabled = false;
     if (requestRevision === revision) status.textContent = 'Current location unavailable. Select a location on the map.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
   });
   confirm.addEventListener('click', () => {
    if (!point) return;
    if (!address.value.trim()) { address.reportValidity(); address.focus(); status.textContent = 'Enter the service address before confirming.'; return; }
    confirmed = true;
    revision++;
    summary.textContent = 'Service location confirmed';
    confirm.textContent = 'Location confirmed';
    describe();
   });
  }
  return {
   value() {
    return confirmed && point ? { ...point, location_confirmed: true, landmark: landmark.value.trim() } : null;
   },
   focus() { status.textContent = 'Confirm the service location before submitting your booking.'; confirm.focus(); host.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
   dispose() { disposed = true; map?.remove(); },
  };
 },
};
