'use strict';
window.SNCustomerTracking = {
 mount(modal, booking) {
  const area=modal.querySelector('[data-live-map]'),status=modal.querySelector('[data-live-status]'),eta=modal.querySelector('[data-live-eta]');
  let map=null,provider=null,destination=null,route=null,timer=null,closed=false,busy=false,fitted=false,routeAt=0,version=0,updated=null;
  const base=`/api/customer/${getCurrentCustomer().id}/bookings/${booking.id}/track`;
  const requests=new Set();
  async function fetchUpdate(url) {
   const controller=new AbortController();requests.add(controller);
   const timeout=setTimeout(()=>controller.abort(),10000);
   try {return await bookingFetch(url,{signal:controller.signal,cache:'no-store'});}
   finally {clearTimeout(timeout);requests.delete(controller);}
  }
  if(window.L) {
   map=L.map(area,{dragging:true,touchZoom:true,scrollWheelZoom:false}).setView([15.145,120.59],13);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  } else area.textContent='Map unavailable. Refresh to retry.';
  function marker(point,label,color) {
   return L.marker([point.lat,point.lng],{title:label,icon:L.divIcon({className:'sn-tracking-marker',html:`<span style="background:${color}">${label==='Provider'?'P':'S'}</span>`,iconSize:[36,36],iconAnchor:[18,18]})}).addTo(map).bindTooltip(label);
  }
  function center() {
   const points=[destination,provider].filter(Boolean).map(m=>m.getLatLng());
   if(points.length) map.fitBounds(L.latLngBounds(points),{padding:[35,35],maxZoom:17});
  }
  modal.querySelector('[data-live-center]').addEventListener('click',()=>{if(map) center();});
  const removeProvider=()=>{if(provider){provider.remove();provider=null;}if(route){route.remove();route=null;}eta.textContent='';version++;};
  async function update() {
   if(closed || busy || document.visibilityState==='hidden') return;
   busy=true;
   try {
    const data=await fetchUpdate(base);
    if(closed) return;
    status.textContent=data.message;
    const updatedStatus=modal.querySelector('[data-live-booking-status]');
    if(updatedStatus) updatedStatus.textContent=data.booking.status;
    updated=data.provider_location?.updated_at || null;
    if(data.customer_pin && map) {
     if(!destination) {destination=marker(data.customer_pin,'Service location','#1c3b91');center();}
     else destination.setLatLng([data.customer_pin.lat,data.customer_pin.lng]);
    }
    if(!data.provider_location) removeProvider();
    else if(map) {
     const p=data.provider_location;
     if(!provider) provider=marker(p,'Provider','#df7100');else provider.setLatLng([p.lat,p.lng]);
     status.textContent=`${data.message} Updated ${new Date(p.updated_at).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true})}${p.accuracy_m!=null?` (+/- ${Math.round(p.accuracy_m)} m)`:''}`;
     if(!fitted && destination) {center();fitted=true;}
     if(destination && Date.now()-routeAt>20000) {
      routeAt=Date.now();const current=++version,d=data.customer_pin;
      const params=new URLSearchParams({from_lat:p.lat,from_lng:p.lng,to_lat:d.lat,to_lng:d.lng});
      fetchUpdate(`/api/directions?${params}`).then(result=>{
       if(closed || current!==version || !updated || Date.now()-Date.parse(updated)>30000) return;
       const info=result.directions;
       if(!info) return;
       route?.remove();
       if(info.geometry) route=L.geoJSON(info.geometry,{style:{color:'#2b53d5',weight:5}}).addTo(map);
       eta.textContent=`Estimated arrival: ${Math.max(1,Math.round(info.duration_s/60))} min (${(info.distance_m/1000).toFixed(1)} km)`;
      }).catch(()=>{if(!closed && current===version) {route?.remove();route=null;eta.textContent='Route estimate unavailable.';}});
     }
    }
    if(data.tracking_state==='ended') {clearInterval(timer);timer=null;}
   } catch(error) {
    if(!closed) {removeProvider();updated=null;status.textContent='Live updates unavailable. Reconnecting...';}
   } finally {busy=false;}
  }
  timer=setInterval(()=>{
   if(updated && Date.now()-Date.parse(updated)>30000) {removeProvider();updated=null;status.textContent='Location updates delayed. Waiting for a fresh GPS reading.';}
   update();
  },5000);
  const resume=()=>update();document.addEventListener('visibilitychange',resume);
  update();
  return ()=>{closed=true;version++;clearInterval(timer);requests.forEach(controller=>controller.abort());document.removeEventListener('visibilitychange',resume);map?.remove();};
 },
};
