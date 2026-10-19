(function () {
 'use strict';
 const esc=adminEscape;
 const date=value=>value ? new Date(value).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric',timeZone:'Asia/Manila'}) : 'Not provided';
 let dialog=null,providerId=null,page=1,version=0;
 const icon=name=>`<img src="/shared/icons/lucide/${name}.svg" alt="" width="18" height="18">`;
 function close() { version++; dialog?.close(); }
 async function load() {
  const current=++version, target=dialog;
  target.querySelector('.admin-provider-detail-body').innerHTML='<p role="status">Loading provider profile...</p>';
  try {
   const data=await adminGet(`/api/admin/providers/${providerId}/details?page=${page}`);
   if(current!==version || !target.open) return;
   const p=data.provider, verification=adminVerificationStatus(p.verification_status);
   target.querySelector('#provider-detail-title').textContent=p.full_name;
   const fields=[['Email',p.email],['Contact',p.contact],['Address',p.address],['Gender',p.gender],['Date of birth',p.dob],['Member since',date(p.created_at)],['Category',p.category],['Service',p.service],['Experience',p.experience_years],['Assessment',`${p.assessment_score}%`],['Badge',p.badge_status]];
   const documents=[];
   if(p.id_front_file) documents.push(['front',0,'Front ID',p.id_front_file]);
   if(p.id_back_file) documents.push(['back',0,'Back ID',p.id_back_file]);
   (p.documents_files || []).forEach((name,index)=>{if(name) documents.push(['credential',index,`Credential / proof of work ${index+1}`,name]);});
   const total=data.review_summary.total, pages=Math.max(1,Math.ceil(total/data.page_size));
   target.querySelector('.admin-provider-detail-body').innerHTML=`
    <section class="admin-provider-detail-section"><div class="admin-panel-head"><h3>Profile Information</h3><span class="status-badge ${verification.className}">${verification.label}</span></div><dl class="admin-provider-info">${fields.map(([name,value])=>`<div><dt>${name}</dt><dd>${esc(value || 'Not provided')}</dd></div>`).join('')}</dl><h4>Description</h4><p class="admin-provider-description">${esc(p.description || 'No description provided.')}</p></section>
    <section class="admin-provider-detail-section"><h3>Submitted Documents</h3><div class="admin-provider-documents">${documents.map(([kind,index,title,name])=>`<div><span><strong>${title}</strong><small>${esc(name.replace(/^\d+-(?:[a-f0-9]{24}|\d+)-/,''))}</small></span><button type="button" class="btn btn-outline" data-document-kind="${kind}" data-document-index="${index}" data-document-name="${esc(name)}" aria-label="Download ${title}">${icon('arrow-down-to-line')} Download</button></div>`).join('') || '<p>No documents submitted.</p>'}</div><p class="admin-detail-file-error" role="alert"></p></section>
    <section class="admin-provider-detail-section"><div class="admin-panel-head"><h3>Customer Feedback</h3><span class="pill">${total ? `${Number(data.review_summary.average).toFixed(1)} / 5` : 'No ratings'} / ${total} review${total===1?'':'s'}</span></div>${data.reviews.map(review=>`<article class="admin-provider-review"><div><strong>${esc(review.customer_name)}</strong><span>${Number(review.rating)} / 5</span></div><p class="admin-review-meta">${esc(review.service || 'Service review')} / ${date(review.created_at)}</p><p>${esc(review.comment || 'Rating only. No written feedback.')}</p></article>`).join('') || '<p>No customer feedback yet.</p>'}<div class="admin-detail-pagination"><span>Page ${data.page} of ${pages}</span><button class="btn btn-outline" type="button" data-reviews-page="${data.page-1}" aria-label="Previous reviews" title="Previous reviews" ${data.page<=1?'disabled':''}>${icon('chevron-left')}</button><button class="btn btn-outline" type="button" data-reviews-page="${data.page+1}" aria-label="Next reviews" title="Next reviews" ${data.page>=pages?'disabled':''}>${icon('chevron-right')}</button></div></section>`;
  } catch(error) {
   if(current===version && target.open) target.querySelector('.admin-provider-detail-body').innerHTML=`<p role="alert">${esc(error.message)}</p><button class="btn btn-outline" type="button" data-detail-retry>Retry</button>`;
  }
 }
 document.addEventListener('click',event=>{
  const opener=event.target.closest('[data-provider-details]');
  if(!opener) return;
  dialog?.close(); providerId=Number(opener.dataset.providerDetails); page=1;
  const target=document.createElement('dialog'); dialog=target;
  target.className='admin-provider-detail'; target.setAttribute('aria-labelledby','provider-detail-title');
  target.innerHTML=`<header><h2 id="provider-detail-title">Provider Profile</h2><button class="btn btn-outline" type="button" data-detail-close aria-label="Close provider profile">${icon('x')}</button></header><div class="admin-provider-detail-body"></div>`;
  target.addEventListener('close',()=>{ target.remove(); if(dialog===target) { dialog=null; version++; } opener.focus(); });
  target.addEventListener('click',async event=>{
   if(event.target.closest('[data-detail-close]')) return close();
   if(event.target.closest('[data-detail-retry]')) return load();
   const next=event.target.closest('[data-reviews-page]');
   if(next && !next.disabled) { page=Number(next.dataset.reviewsPage); await load(); target.querySelector('.admin-detail-pagination')?.scrollIntoView({block:'nearest'}); return; }
   const button=event.target.closest('[data-document-kind]');
   if(!button || button.disabled) return;
   button.disabled=true;
   const error=target.querySelector('.admin-detail-file-error'); error.textContent='';
   try {
    const response=await fetch(`${ADMIN_API_BASE}/api/admin/providers/${providerId}/documents/${button.dataset.documentKind}/${button.dataset.documentIndex}`,{credentials:'same-origin',headers:adminAuthHeaders()});
    if(!response.ok) throw new Error((await response.json().catch(()=>({}))).message || 'Unable to download this document.');
    const url=URL.createObjectURL(await response.blob());
    const link=document.createElement('a'); link.href=url; link.download=button.dataset.documentName; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   } catch(problem) { error.textContent=problem.message; }
   finally { button.disabled=false; }
  });
  document.body.append(target); target.showModal(); load();
 });
})();
