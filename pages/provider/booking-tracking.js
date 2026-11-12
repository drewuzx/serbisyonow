'use strict';
(() => {
 let active=null, watch=null, timer=null, generation=0, starting=false;
 let message='';
 function render() {
  document.querySelectorAll('[data-live-tracking]').forEach(button=>{
   const sharing=String(active?.id)===button.dataset.liveTracking;
   const booking=providerRequestsState.bookings.find(item=>String(item.id)===button.dataset.liveTracking);
   const canStart=SNScheduleWindow.canStartService(booking);
   button.textContent=sharing?'Stop sharing location':'On the way';
   button.disabled=starting||(!sharing&&!canStart);
   button.title=sharing||canStart?'':SNScheduleWindow.startServiceMessage(booking);
   button.setAttribute('aria-pressed',String(sharing));
  });
  const notice=document.getElementById('sn-live-tracking-notice');
  if(notice) {notice.textContent=message;notice.hidden=!message;}
 }
 function tell(text) {message=text;render();}
 const path=id=>`/api/provider/${getProviderUser().id}/bookings/${id}/tracking`;
 async function request(url,method,body,keepalive=false) {
  const user=getProviderUser();
  const response=await fetch(`${PROVIDER_API_BASE}${url}`,{method,keepalive,signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(user?.auth_token?{Authorization:`Bearer ${user.auth_token}`}:{})},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) {const e=new Error(data.message||'Location update failed.');e.status=response.status;throw e;}
  return data;
 }
 function stop(text='Live location sharing stopped.') {
  generation++;
  if(watch!==null) navigator.geolocation.clearWatch(watch);
  clearInterval(timer);watch=null;timer=null;starting=false;
  const old=active;active=null;tell(text);
  if(old) request(old.path+'/stop','POST',{session_id:old.session},true).catch(()=>{});
 }
 async function send(position,force=false) {
  if(!active || active.sending || (!force && Date.now()-active.lastSent<5000)) return;
  if(Date.now()-position.timestamp>30000) {tell('GPS delayed. Waiting for a fresh location.');return;}
  const current=active;
  current.sending=true;current.lastSent=Date.now();
  try {
   await request(current.path,'PATCH',{session_id:current.session,sequence:++current.sequence,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,observed_at:new Date(position.timestamp).toISOString()});
   if(active!==current) return;
   current.point={lat:position.coords.latitude,lng:position.coords.longitude};
   tell('Sharing live location with this booking\'s customer. Keep this page open.');
   document.dispatchEvent(new CustomEvent('sn:booking-location-sent',{detail:current.point}));
  } catch(error) {
   if(active!==current) return;
   if([401,403,404,409].includes(error.status)) stop(error.message);
   else tell('Connection interrupted. Location sharing will retry; the customer will see delayed updates.');
  } finally {current.sending=false;}
 }
 function gpsError(error) {
  if(error.code===1) stop('Location permission denied. Live sharing has stopped.');
  else tell('GPS unavailable. Waiting for a fresh location.');
 }
 async function toggle(id) {
  if(starting) return;
  if(String(active?.id)===String(id)) {stop();return;}
  const booking=providerRequestsState.bookings.find(item=>String(item.id)===String(id));
  if(!SNScheduleWindow.canStartService(booking)) {tell(SNScheduleWindow.startServiceMessage(booking));return;}
  if(!navigator.geolocation) {tell('Location access is unavailable in this browser.');return;}
  if(active) stop();
  starting=true;const version=++generation;tell('Requesting location permission...');
  try {
   const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
   if(version!==generation) return;
   const url=path(id),data=await request(url,'POST',{});
   if(version!==generation) {request(url+'/stop','POST',{session_id:data.session_id},true).catch(()=>{});return;}
   active={id,path:url,session:data.session_id,sequence:0,point:null,sending:false,lastSent:0};
   starting=false;await send(position,true);render();
   if(version!==generation || !active) return;
   const current=active;
   const receive=position=>{if(active===current) send(position);};
   const failed=error=>{if(active===current) gpsError(error);};
   watch=navigator.geolocation.watchPosition(receive,failed,{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
   timer=setInterval(()=>{
    if(active===current && !current.sending) navigator.geolocation.getCurrentPosition(receive,failed,{enableHighAccuracy:true,timeout:9000,maximumAge:5000});
   },10000);
  } catch(error) {if(version===generation) {starting=false;tell(error.code===1?'Location permission denied. Nothing was shared.':error.message||'Unable to start live tracking.');}}
 }
 document.addEventListener('sn:provider-data-updated',event=>{
  if(!active) return;
  const booking=event.detail.bookings?.find(b=>String(b.id)===String(active.id));
  if(!booking || !['upcoming','ongoing'].includes(booking.status)) stop('This booking has ended. Live sharing stopped.');
 });
 window.addEventListener('pagehide',()=>stop());
 window.addEventListener('offline',()=>{if(active) tell('You are offline. Live location updates are paused.');});
 window.SNProviderTracking={toggle,render,stop,point:()=>active?.point||null,ended:id=>{if(String(active?.id)===String(id)) stop('This booking has ended. Live sharing stopped.');}};
})();
