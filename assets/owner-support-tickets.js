/* A13 Owner Support: separate from customer support, no financial operations. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerSupport=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const categories=['Orders','POS','Accounts','Hotel','Technical','Other'];
 const statuses=['Open','In Progress','Resolved','Closed'];
 const fields='id,restaurant_id,owner_id,category,subject,message,status,admin_response,created_at,updated_at';
 let ctx=null,scope='',epoch=0,pending=null,busy=false,host=null,loadSeq=0;
 function identity(a,u){
  if(!u?.id)return '';
  if(a?.role==='super_admin')return 'admin:'+u.id;
  if(a?.role==='owner'&&a.restaurantId)return 'owner:'+u.id+':'+a.restaurantId;
  return '';
 }
 function current(){return ctx?identity(ctx.getAccess(),ctx.getUser()):'';}
 function clear(){epoch++;loadSeq++;scope='';pending=null;busy=false;host?.remove();host=null;}
 function sync(){
  const key=current();
  if(key!==scope){clear();scope=key;}
  return key;
 }
 function init(options){clear();ctx=options;}
 function node(tag,value){const e=document.createElement(tag);if(value!=null)e.textContent=String(value);return e;}
 function button(label,fn){const b=node('button',label);b.type='button';b.className='btn secondary';b.style.minHeight='44px';b.onclick=fn;return b;}
 function control(tag,name,label,options){
  const l=node('label',label);l.style.display='grid';l.style.gap='4px';
  const e=node(tag);e.name=name;e.required=true;e.style.cssText='width:100%;min-width:0;box-sizing:border-box;font-size:16px';
  if(options)for(const value of options){const o=node('option',value);o.value=value;e.append(o);}
  l.append(e);return {label:l,input:e};
 }
 function normalize(category,subject,message){
  const s=String(subject||'').trim(),m=String(message||'').trim();
  if(!categories.includes(category)||s.length<3||s.length>120||m.length<5||m.length>2000)throw Error('Choose a category, subject 3–120 and message 5–2000 characters.');
  return {category,subject:s,message:m};
 }
 function matching(row,request,userId){
  return !!row&&row.id===request.id&&row.restaurant_id===request.restaurant_id&&row.owner_id===userId&&row.category===request.category&&row.subject===request.subject&&row.message===request.message;
 }
 async function createOrRecover(client,request,userId){
  let row;
  try{
   const result=await client.from('owner_support_tickets').insert(request).select(fields).single();
   if(!result.error)row=result.data;
  }catch(_){}
  if(matching(row,request,userId))return row;
  const lookup=await client.from('owner_support_tickets').select(fields).eq('id',request.id).eq('restaurant_id',request.restaurant_id).eq('owner_id',userId).maybeSingle();
  if(lookup.error||!matching(lookup.data,request,userId))throw Error('Ticket not confirmed. Keep this form and retry the same request.');
  return lookup.data;
 }
 const attachmentBucket='bite-owner-support';
 const attachmentTypes=['image/jpeg','image/png','image/webp'];
 function attachmentPath(id){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid ticket reference.');
  return id+'/screenshot';
 }
 async function validateScreenshot(file){
  if(!file||!attachmentTypes.includes(file.type)||file.size<12||file.size>3145728)throw Error('Choose a JPEG, PNG or WebP screenshot up to 3 MB.');
  const b=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
  const jpeg=b[0]===255&&b[1]===216&&b[2]===255;
  const webp=String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
  if(!(file.type==='image/png'?png:file.type==='image/jpeg'?jpeg:webp))throw Error('Image content does not match its file type.');
  return file;
 }
 async function screenshotInfo(client,id){
  attachmentPath(id);
  const {data,error}=await client.storage.from(attachmentBucket).list(id,{limit:2,search:'screenshot'});
  if(error||!Array.isArray(data))throw Error('Screenshot availability could not be confirmed.');
  return data.some(x=>x.name==='screenshot');
 }
 async function uploadScreenshot(client,id,file,active=()=>true){
  await validateScreenshot(file);
  if(!active())throw Error('Session changed.');
  const path=attachmentPath(id),bucket=client.storage.from(attachmentBucket);
  const result=await bucket.upload(path,file,{contentType:file.type,upsert:false});
  if(result.error||result.data?.path!==path)throw Error('Upload not confirmed. Refresh screenshot status before retrying; existing files cannot be replaced.');
  return true;
 }
 async function downloadScreenshot(client,id){
  const {data,error}=await client.storage.from(attachmentBucket).download(attachmentPath(id));
  if(error||!data)throw Error('Screenshot unavailable.');
  await validateScreenshot(data);
  return data;
 }
 async function readHistory(client,ticketId){
  const {data,error,count}=await client.from('owner_support_ticket_events').select('id,ticket_id,event_kind,previous_status,status,response,occurred_at',{count:'exact'}).eq('ticket_id',ticketId).order('id',{ascending:false}).limit(100);
  if(error||!Array.isArray(data)||data.some(e=>e.ticket_id!==ticketId))throw Error('Ticket history could not be verified.');
  return {events:data,count:count??data.length};
 }
 async function updateTicket(client,row,status,response){
  const reply=String(response||'').trim();
  if(!statuses.includes(status)||reply.length>2000||!row.updated_at)throw Error('Invalid reply or ticket revision. Refresh first.');
  const result=await client.from('owner_support_tickets').update({status,admin_response:reply||null}).eq('id',row.id).eq('updated_at',row.updated_at).select(fields).maybeSingle();
  if(result.error||!result.data||result.data.id!==row.id||result.data.status!==status||result.data.admin_response!==(reply||null))throw Error('Update not confirmed. Refresh to check the latest ticket before saving again.');
  return result.data;
 }
 function mount(page){
  const key=sync(),admin=key.startsWith('admin:');
  if(!key||page!==(admin?'support':'settings'))return;
  const target=document.getElementById(page);if(!target||!target.classList.contains('active'))return;
  if(host?.isConnected){return;}
  if(busy)return; // Wait for the in-flight request instead of mounting a second disabled form.
  const version=epoch,access=ctx.getAccess(),userId=ctx.getUser().id,rid=access.restaurantId;
  host=node('section');host.id='biteOwnerSupportPanel';host.className='card';host.style.cssText='display:grid;gap:12px;min-width:0;overflow-wrap:anywhere;margin:16px 0';
  const panel=host;
  const valid=()=>version===epoch&&current()===key&&host===panel&&panel.isConnected;
  const info=node('p',''),list=node('div');info.setAttribute('role','status');list.style.cssText='display:grid;gap:12px;min-width:0';
  panel.append(node('h3',admin?'Restaurant Owner support':'Help & Support'),node('p',admin?'Owner tickets are separate from customer requests.':'Send restaurant issues to Bite. Never include passwords, guest IDs, card or bank details.'));
  const refresh=button('Refresh tickets',()=>void load());
  let form,controls,send;
  if(!admin){
   form=node('form');form.style.cssText='display:grid;gap:12px;min-width:0';
   controls=[control('select','category','Category',categories),control('input','subject','Subject'),control('textarea','message','Describe the issue')];
   controls[1].input.maxLength=120;controls[2].input.maxLength=2000;controls[2].input.rows=4;
   if(pending){for(const c of controls)c.input.value=pending[c.input.name];}
   send=node('button',pending?'Retry same ticket':'Create ticket');send.type='submit';send.className='btn';send.style.minHeight='44px';
   const lock=()=>{for(const c of controls)c.input.disabled=!!pending||busy;send.disabled=busy;send.textContent=busy?'Checking…':pending?'Retry same ticket':'Create ticket';};
   form.append(...controls.map(c=>c.label),send);lock();
   form.onsubmit=async event=>{
    event.preventDefault();if(!valid()||busy)return;
    try{
     if(!pending)pending={id:crypto.randomUUID(),restaurant_id:rid,...normalize(...controls.map(c=>c.input.value))};
     busy=true;lock();info.textContent='Checking ticket confirmation…';
     const ticket=await createOrRecover(ctx.sb,pending,userId);
     if(version!==epoch||current()!==key)return;
     pending=null;
     if(!valid())return;
     form.reset();info.textContent='Ticket confirmed: '+ticket.id;
     await load(true);
    }catch(e){if(valid())info.textContent=e.message||'Ticket not confirmed. Retry.';}
    finally{if(version===epoch){busy=false;if(valid())lock();else if(current()===key)mount(page);}}
   };
   panel.append(form);
  }
  panel.append(refresh,info,list);target.prepend(panel);
  async function load(keepNotice=false){
   if(!valid())return;
   const sequence=++loadSeq,active=()=>valid()&&sequence===loadSeq;
   if(!keepNotice)info.textContent='Loading tickets…';
   list.replaceChildren();refresh.disabled=true;
   try{
    let q=ctx.sb.from('owner_support_tickets').select(fields,{count:'exact'}).order('created_at',{ascending:false}).limit(100);
    if(!admin)q=q.eq('restaurant_id',rid).eq('owner_id',userId);
    const {data,error,count}=await q;
    if(!active())return;
    if(error||!Array.isArray(data)||(!admin&&data.some(t=>t.restaurant_id!==rid||t.owner_id!==userId)))throw Error('Ticket list unavailable.');
    for(const row of data){
     const card=node('article');card.style.cssText='display:grid;gap:8px;border:1px solid #ddd;border-radius:12px;padding:12px;min-width:0;white-space:pre-wrap';
     const meta=node('small',row.category+' · '+row.status+' · '+row.created_at),answered=node('p',row.admin_response?'Bite: '+row.admin_response:'Awaiting Bite response');
     card.append(node('strong',row.subject),meta,node('small','Ticket '+row.id),node('p',row.message),answered);
     const history=node('details'),summary=node('summary','Case history'),timeline=node('div');
     summary.style.cssText='cursor:pointer;min-height:44px;padding:10px 0';timeline.style.cssText='display:grid;gap:8px';
     const historyNotice=node('p');historyNotice.setAttribute('role','status');timeline.append(historyNotice);
     history.append(summary,timeline);
     let historyVersion=0;
     async function openHistory(){
      const sequence=++historyVersion,live=()=>valid()&&card.isConnected&&history.open&&sequence===historyVersion;
      if(!live())return;
      timeline.replaceChildren(historyNotice);historyNotice.textContent='Loading case history…';
      try{
       const {events,count}=await readHistory(ctx.sb,row.id);if(!live())return;
       historyNotice.textContent=events.length?'Showing '+events.length+' of '+count+' recorded events.':'No recorded history yet; earlier events may predate history tracking.';
       for(const event of events){
        const entry=node('div');entry.style.cssText='border-left:2px solid #ddd;padding-left:10px';
        entry.append(node('strong',event.event_kind==='Opened'?'Ticket opened':(event.previous_status===event.status?'Reply updated':event.previous_status+' → '+event.status)),node('small',' · '+new Date(event.occurred_at).toLocaleString('en-IN')));
        if(event.response)entry.append(node('p',event.response));
        timeline.append(entry);
       }
      }catch(e){if(live())historyNotice.textContent='History unavailable. Close and reopen to retry.';}
     }
     history.ontoggle=()=>{if(history.open)void openHistory();else{historyVersion++;timeline.replaceChildren(historyNotice);historyNotice.textContent='';}};
     card.append(history);
     const attach=node('details'),attachSummary=node('summary','Private screenshot'),attachmentStatus=node('p'),attachmentActions=node('div');
     attachmentStatus.setAttribute('role','status');attachmentActions.style.cssText='display:grid;gap:8px;min-width:0';
     attach.append(attachSummary,attachmentStatus,attachmentActions);card.append(attach);
     let attachmentSeq=0,attachmentBusy=false;
     async function refreshAttachment(){
      const seq=++attachmentSeq,live=()=>valid()&&card.isConnected&&attach.open&&seq===attachmentSeq;
      if(!live())return;
      attachmentActions.replaceChildren();attachmentStatus.textContent='Checking screenshot…';
      try{
       const exists=await screenshotInfo(ctx.sb,row.id);if(!live())return;
       if(exists){
        attachmentStatus.textContent='Screenshot attached. Visible only to authorised ticket participants.';
        attachmentActions.append(button('Download screenshot',async()=>{
         if(!live()||attachmentBusy)return;attachmentBusy=true;
         try{
          const blob=await downloadScreenshot(ctx.sb,row.id);if(!live())return;
          const url=URL.createObjectURL(new Blob([blob],{type:'application/octet-stream'})),a=node('a');
          a.href=url;a.download='bite-support-screenshot.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type]);a.rel='noopener';
          document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
         }catch(e){if(live())attachmentStatus.textContent=e.message;}
         finally{attachmentBusy=false;}
        }));
       }else if(!admin&&['Open','In Progress'].includes(row.status)){
        attachmentStatus.textContent='Optional: one screenshot, up to 3 MB. Remove guest IDs, passwords and financial details before attaching. Cannot replace from the dashboard.';
        const file=node('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('aria-label','Select support screenshot');
        const upload=button('Attach screenshot',async()=>{
         if(!live()||attachmentBusy)return;attachmentBusy=true;upload.disabled=true;
         try{await uploadScreenshot(ctx.sb,row.id,file.files?.[0],live);if(live()){attachmentStatus.textContent='Screenshot uploaded.';await refreshAttachment();}}
         catch(e){if(live()){attachmentStatus.textContent=e.message;attachmentActions.append(button('Recheck attachment',()=>void refreshAttachment()));}}
         finally{attachmentBusy=false;if(live())upload.disabled=false;}
        });attachmentActions.append(file,upload);
       }else{attachmentStatus.textContent='No screenshot attached.';}
      }catch(e){if(live())attachmentStatus.textContent='Screenshot unavailable. Close and reopen to retry.';}
     }
     attach.ontoggle=()=>{if(attach.open)void refreshAttachment();else{attachmentSeq++;attachmentActions.replaceChildren();attachmentStatus.textContent='';}};
     if(admin){
      card.append(node('small','Restaurant '+row.restaurant_id));
      const st=control('select','status','Status',statuses),reply=control('textarea','response','Bite response');
      reply.input.required=false;reply.input.maxLength=2000;reply.input.rows=3;reply.input.value=row.admin_response||'';st.input.value=row.status;
      const result=node('p');result.setAttribute('role','status');let saving=false;
      const save=button('Save status & reply',async()=>{
       if(!valid()||saving||!card.isConnected)return;
       saving=true;save.disabled=true;result.textContent='Saving…';
       try{const saved=await updateTicket(ctx.sb,row,st.input.value,reply.input.value);if(valid()&&card.isConnected){Object.assign(row,saved);meta.textContent=row.category+' · '+row.status+' · '+row.created_at;answered.textContent=row.admin_response?'Bite: '+row.admin_response:'Awaiting Bite response';result.textContent='Update confirmed.';if(history.open)void openHistory();}}
       catch(e){if(valid()&&card.isConnected)result.textContent=e.message;}
       finally{saving=false;if(valid()&&card.isConnected)save.disabled=false;}
      });
      card.append(st.label,reply.label,save,result);
     }
     list.append(card);
    }
    if(!data.length)list.append(node('p','No tickets yet.'));
    if(!keepNotice)info.textContent='Showing '+data.length+' of '+(count??data.length)+' tickets.';
   }catch(e){if(active())info.textContent='Support unavailable. Refresh or contact Bite via the existing Contact page.';}
   finally{if(active())refresh.disabled=false;}
  }
  void load();
 }
 return {init,mount,clear,sync,identity,normalize,matching,createOrRecover,updateTicket,readHistory,attachmentPath,validateScreenshot,screenshotInfo,uploadScreenshot,downloadScreenshot};
});
