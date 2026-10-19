(() => {
 'use strict';
 const el = id => document.getElementById(id);
 el('report-days').setAttribute('aria-label','Period');
 el('provider-ranking').setAttribute('aria-label','Rank by');
 const money = cents => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(cents)/100);
 const count = n => Number(n).toLocaleString('en-PH');
 const date = value => new Date(value).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'});
 const percent = (n,total) => total ? Math.round(n/total*100) : 0;
 let latest = null, version = 0;
 function comparison(current,previous) {
  if(!previous) return current ? 'No activity in previous period' : 'No change from previous period';
  const change=(current-previous)/previous*100;
  return `${change>0?'+':''}${change.toFixed(1)}% vs previous period`;
 }
 function bars(target,rows) {
  const max=Math.max(...rows.map(r=>r.value),1);
  el(target).innerHTML=rows.map(r=>`<div><div class="report-bar-label"><span>${adminEscape(r.name)}</span><strong>${count(r.value)}</strong></div><div class="report-track"><i ${r.status ? `data-status="${r.status}"` : ''} style="width:${r.value/max*100}%"></i></div></div>`).join('') || '<p>No bookings in this period.</p>';
 }
 function buckets(data) {
  const rows=[];
  data.trend.forEach((day,index)=>{
   const key=data.days===365 ? day.date.slice(0,7) : data.days===90 ? Math.floor(index/7) : index;
   let row=rows[rows.length-1];
   if(!row || row.key!==key) { row={key,start:day.date,end:day.date,bookings:0,completed:0,revenue_centavos:0}; rows.push(row); }
   row.end=day.date; row.bookings+=day.bookings; row.completed+=day.completed; row.revenue_centavos+=day.revenue_centavos;
  });
  return rows;
 }
 function chart(target,detail,rows,revenue) {
  const max=Math.max(...rows.map(r=>revenue?r.revenue_centavos:r.bookings),1);
  const label=row=>`${date(row.start)}${row.end!==row.start ? ` - ${date(row.end)}` : ''}: ${revenue?money(row.revenue_centavos):`${count(row.bookings)} bookings, ${count(row.completed)} completed`}`;
  el(target).innerHTML=rows.map((row,index)=>`<button type="button" class="report-bar-button" data-index="${index}" aria-label="${adminEscape(label(row))}" title="${adminEscape(label(row))}"><span class="${revenue?'revenue':''}" style="height:${(revenue?row.revenue_centavos:row.bookings)/max*100}%"></span>${revenue?'':`<span class="completed" style="height:${row.completed/max*100}%"></span>`}</button>`).join('');
  let axis=el(`${target}-axis`);
  if(!axis) { axis=document.createElement('div'); axis.id=`${target}-axis`; axis.className='report-chart-axis'; el(target).after(axis); }
  axis.innerHTML=`<span>${date(rows[0].start)}</span><span>${date(rows[rows.length-1].end)}</span>`;
  const actualMax=Math.max(...rows.map(r=>revenue?r.revenue_centavos:r.bookings));
  el(detail).textContent=actualMax ? `Peak: ${revenue?money(actualMax):`${count(actualMax)} bookings`} per ${latest.days===365?'month':latest.days===90?'7-day interval':'day'}` : revenue?'No verified payments in this period.':'No bookings in this period.';
  const show=event=>{ const button=event.target.closest('[data-index]'); if(button) el(detail).textContent=label(rows[Number(button.dataset.index)]); };
  el(target).onpointerover=show; el(target).onclick=show;
  el(target).querySelectorAll('button').forEach(button=>{ button.onfocus=show; });
 }
 function render(data) {
  const {bookings:b,revenue:r,reviews}=data;
  el('report-period').textContent=`${date(data.period.start)} - ${date(new Date(new Date(data.period.finish).getTime()-1))} | Asia/Manila`;
  const metrics=[['Bookings',count(b.total),comparison(b.total,b.previous_total)],['Completion rate',b.total?`${percent(b.completed,b.total)}%`:'Not available',`${count(b.completed)} of ${count(b.total)} bookings completed`],['System earnings',money(r.total_centavos),comparison(r.total_centavos,r.previous_centavos)],['Provider rating',reviews.average ? `${reviews.average.toFixed(1)} / 5`:'Not rated',`${count(reviews.count)} customer reviews`]];
  el('report-metrics').innerHTML=metrics.map(([label,value,note])=>`<div class="report-metric"><span>${label}</span><strong>${adminEscape(value)}</strong><small>${adminEscape(note)}</small></div>`).join('');
  const rows=buckets(data);
  chart('booking-chart','booking-detail',rows,false);
  chart('revenue-chart','revenue-detail',rows,true);
  bars('category-summary',data.categories.map(c=>({name:c.name,value:c.bookings})));
  bars('booking-outcomes',[{name:'Completed',value:b.completed,status:'completed'},{name:'Pending / upcoming / ongoing',value:b.active,status:'active'},{name:'Cancelled',value:b.cancelled,status:'cancelled'}]);
  el('revenue-plans').innerHTML=data.plans.map(p=>`<div><span>${adminEscape(p.plan_name)}<small>${count(p.payments)} verified ${p.payments===1?'payment':'payments'}</small></span><strong>${money(p.revenue_centavos)}</strong></div>`).join('');
  const insights=[];
  if(data.categories.length) { const top=data.categories[0]; insights.push(`${top.name} leads with ${count(top.bookings)} bookings (${percent(top.bookings,b.total-b.cancelled)}% of non-cancelled bookings).`); }
  if(b.cancelled) insights.push(`${count(b.cancelled)} ${b.cancelled===1?'booking was':'bookings were'} cancelled (${percent(b.cancelled,b.total)}%). Review cancelled bookings for recurring issues.`);
  else if(b.total) insights.push('No cancellations recorded for bookings in this period.');
  if(b.previous_total) insights.push(`Booking volume: ${comparison(b.total,b.previous_total).toLowerCase()}.`);
  if(r.payments) insights.push(`${count(r.payments)} verified subscription/promotion payments generated ${money(r.total_centavos)} in system earnings.`);
  el('report-insights').innerHTML=insights.map(text=>`<li>${adminEscape(text)}</li>`).join('') || '<li>No activity recorded in this period.</li>';
  el('top-providers').innerHTML=data.providers.map((p,index)=>`<tr><td data-label="Provider">${index+1}. ${adminEscape(p.full_name)}</td><td data-label="Bookings">${count(p.bookings)}</td><td data-label="Completed">${count(p.completed)}</td><td data-label="Rating">${p.rating ? `${p.rating.toFixed(1)} / 5`:'Not rated'}</td><td data-label="Reviews">${count(p.reviews)}</td></tr>`).join('') || '<tr><td colspan="5">No providers with matching activity in this period.</td></tr>';
 }
 async function loadReports(options={}) {
  if(options.background && el('report-content').contains(document.activeElement)) return;
  const request=++version;
  if(!options.background) { el('report-message').textContent='Loading analytics...'; el('report-content').hidden=true; latest=null; el('export-report').disabled=true; }
  try {
   const data=await adminGet(`/api/admin/reports?days=${el('report-days').value}&sort=${el('provider-ranking').value}`);
   if(request!==version || (options.background && (!adminCanRefresh() || el('report-content').contains(document.activeElement)))) return;
   if(!adminDataChanged('reports',data,options) && !el('report-message').textContent) return;
   latest=data; render(data);
   el('report-content').hidden=false; el('report-login').hidden=true; el('report-message').textContent=''; el('report-message').className=''; el('export-report').disabled=false;
  } catch(error) {
   if(request!==version) return;
   el('report-message').className='report-error';
   el('report-message').textContent=options.background && latest ? 'Refresh failed. Showing previously loaded data.' : error.message;
   if(error.status===401 || error.status===403) { latest=null; el('report-content').hidden=true; el('export-report').disabled=true; el('report-login').hidden=false; }
  }
 }
 function exportReport() {
  if(!latest) return;
  const d=latest,b=d.bookings,r=d.revenue;
  const rows=[['SerbisyoNow Reports & Analytics'],['Period (Asia/Manila)',date(d.period.start),date(new Date(new Date(d.period.finish).getTime()-1))],[],
   ['Metric','Value'],['Bookings',b.total],['Previous period bookings',b.previous_total],['Completed',b.completed],['Active',b.active],['Cancelled',b.cancelled],['Verified system earnings (PHP)',(r.total_centavos/100).toFixed(2)],['Previous earnings (PHP)',(r.previous_centavos/100).toFixed(2)],['Average provider rating',d.reviews.average || 'Not rated'],['Customer reviews',d.reviews.count],[],
   ['Daily trend','Bookings','Completed (current status)','Verified earnings (PHP)'],...d.trend.map(t=>[t.date,t.bookings,t.completed,(t.revenue_centavos/100).toFixed(2)]),[],
   ['Category','Non-cancelled bookings'],...d.categories.map(c=>[c.name,c.bookings]),[],
   ['Top providers',d.sort],['Provider','Non-cancelled bookings','Completed','Rating','Reviews'],...d.providers.map(p=>[p.full_name,p.bookings,p.completed,p.rating || 'Not rated',p.reviews]),[],
   ['Subscription / Promotion','Verified payments','Revenue (PHP)'],...d.plans.map(p=>[p.plan_name,p.payments,(p.revenue_centavos/100).toFixed(2)])];
  const cell=value=>{ let text=String(value); if(/^[\s]*[=+@-]/.test(text)) text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; };
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a'); link.href=url; link.download=`serbisyonow-report-${d.days}-days.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 el('report-days').addEventListener('change',()=>loadReports());
 el('provider-ranking').addEventListener('change',()=>loadReports());
 el('refresh-report').addEventListener('click',()=>loadReports());
 el('export-report').addEventListener('click',exportReport);
 adminLive('reports',loadReports);
 loadReports();
})();
