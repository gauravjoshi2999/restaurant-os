/* Bite Owner Menu Options — tenant-scoped setup only; paid checkout remains disabled. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteMenuOptions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_PRICE=10000;
 const MAX_CHOICES_PER_GROUP=30;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const byId=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>'₹'+Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const safeId=value=>UUID.test(String(value||''))?String(value):null;
 function validateChoice(name,price){
  const n=String(name??'').trim();
  const raw=String(price??'').trim();
  if(!n||n.length>80)throw Error('Option name 1–80 characters ka hona chahiye.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||!Number.isFinite(Number(raw))||Number(raw)>MAX_PRICE)
   throw Error('Extra charge ₹0–₹10,000 tak aur maximum 2 decimal ka ho.');
  return {name:n,price_delta:Number(raw)};
 }
 function validateGroup(name,min,max,choiceCount){
  const n=String(name??'').trim(),low=Number(min),high=Number(max);
  if(!n||n.length>80)throw Error('Group name 1–80 characters ka hona chahiye.');
  if(!Number.isInteger(low)||!Number.isInteger(high)||low<0||high<1||high>8||low>high)
   throw Error('Minimum 0–8, Maximum 1–8 aur minimum maximum se bada nahi hona chahiye.');
  if(choiceCount!==undefined&&(choiceCount<1||choiceCount>MAX_CHOICES_PER_GROUP||choiceCount<low))
   throw Error('Kam se kam ek option add karein; available options minimum selection se kam nahi ho sakte.');
  return {name:n,min_select:low,max_select:high};
 }
 function validateDraftChoices(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_CHOICES_PER_GROUP)
   throw Error('Ek group mein 1–30 options rakhein.');
  const choices=rows.map(row=>validateChoice(row.name,row.price_delta));
  if(new Set(choices.map(c=>c.name.toLocaleLowerCase())).size!==choices.length)
   throw Error('Ek group mein ek hi naam ke do options nahi ho sakte.');
  return choices;
 }
 let deps=null,selected=null,linked=[],groups=[],choices=[],busy=false,sequence=0,focusReturn=null;
 function safeContext(){
  if(!deps||!selected||deps.getRestaurantId()!==selected.restaurantId
     ||!deps.canEditRestaurant(selected.restaurantId)
     ||!deps.getMenuItems().some(item=>item.id===selected.itemId))
   throw Error('Restaurant badal gaya hai. Menu dobara kholein.');
  return selected;
 }
 function feedback(message,error=false){
  const el=byId('menuOptionsFeedback');
  if(el){el.textContent=message;el.classList.toggle('error',!!error);}
 }
 function setBusy(value){
  busy=!!value;
  const modal=byId('menuOptionsModal');
  if(!modal)return;
  modal.setAttribute('aria-busy',String(busy));
  modal.querySelectorAll('button[type="submit"],button[data-options-action]').forEach(button=>{
   button.disabled=busy;
  });
 }
 function addDraftRow(){
  const area=byId('menuOptionsDraftChoices');
  if(!area||area.querySelectorAll('.bite-option-draft-row').length>=MAX_CHOICES_PER_GROUP){
   feedback('Ek group mein maximum 30 options ho sakte hain.',true);return;
  }
  const row=document.createElement('div');
  row.className='bite-option-draft-row';
  row.innerHTML='<label>Option name<input name="option_name" maxlength="80" placeholder="e.g. Half, Full, Extra Cheese" required></label>'
   +'<label>Extra charge (₹)<input name="option_price" type="number" min="0" max="10000" step="0.01" value="0" required></label>'
   +'<button type="button" class="btn secondary" data-options-action="remove-draft" aria-label="Remove this option">Remove</button>';
  area.appendChild(row);
 }
 function readDraftChoices(){
  return Array.from(byId('menuOptionsDraftChoices').querySelectorAll('.bite-option-draft-row')).map(row=>({
   name:row.querySelector('[name="option_name"]').value,
   price_delta:row.querySelector('[name="option_price"]').value
  }));
 }
 function groupMarkup(g,link){
  const rows=choices.filter(c=>c.option_group_id===g.id);
  const active=!!g.is_available&&!!link.is_available;
  return '<section class="bite-option-group-card" data-option-group-id="'+esc(g.id)+'">'
    +'<header><div><strong>'+esc(g.name)+'</strong><div class="small">'
    +esc(String(g.min_select))+' minimum · '+esc(String(g.max_select))+' maximum · '
    +rows.length+' options</div></div>'
    +'<span class="pill '+(active?'green':'amber')+'">'+(active?'Configured':'Paused')+'</span></header>'
    +'<div class="bite-option-choice-list">'+(rows.length?rows.map(c=>
       '<form class="bite-option-choice-row" data-options-form="choice-edit" data-choice-id="'+esc(c.id)+'" data-group-id="'+esc(g.id)+'">'
       +'<label>Choice<input name="name" maxlength="80" required value="'+esc(c.name)+'"></label>'
       +'<label>Extra ₹<input name="price_delta" type="number" step="0.01" min="0" max="10000" required value="'+esc(Number(c.price_delta).toFixed(2))+'"></label>'
       +'<button type="submit" class="btn secondary">Save</button>'
       +'<button type="button" class="btn secondary" data-options-action="choice-toggle" data-choice-id="'+esc(c.id)+'">'
       +(c.is_available?'Pause':'Enable')+'</button></form>'
       ).join(''):'<p class="small">Abhi choices nahi hain. Niche add karein.</p>')+'</div>'
    +'<form class="bite-option-new-choice" data-options-form="choice-add" data-group-id="'+esc(g.id)+'">'
    +'<label>New choice<input name="name" maxlength="80" required placeholder="e.g. Full"></label>'
    +'<label>Extra ₹<input name="price_delta" type="number" step="0.01" min="0" max="10000" value="0" required></label>'
    +'<button type="submit" class="btn secondary">＋ Add choice</button></form>'
    +'<details class="bite-option-group-settings"><summary>Edit group name & selection limits</summary>'
    +'<form data-options-form="group-edit" data-group-id="'+esc(g.id)+'">'
    +'<label>Group name<input name="name" maxlength="80" required value="'+esc(g.name)+'"></label>'
    +'<label>Min select<input name="min_select" type="number" min="0" max="8" step="1" required value="'+esc(g.min_select)+'"></label>'
    +'<label>Max select<input name="max_select" type="number" min="1" max="8" step="1" required value="'+esc(g.max_select)+'"></label>'
    +'<button class="btn secondary" type="submit">Save group</button></form></details>'
    +'<div class="bite-option-group-footer"><button type="button" class="btn secondary" data-options-action="link-toggle" data-group-id="'+esc(g.id)+'">'
    +(active?'Pause for this dish':'Enable for this dish')+'</button>'
    +'<span class="small">Owner setup only · Customer paid checkout abhi OFF hai</span></div></section>';
 }
 function render(){
  const area=byId('menuOptionsGroupList');
  if(!area)return;
  const attached=linked.map(link=>({link,group:groups.find(g=>g.id===link.option_group_id)}))
    .filter(x=>x.group);
  area.innerHTML=attached.length?attached.map(x=>groupMarkup(x.group,x.link)).join('')
    :'<div class="empty">Is dish ke liye abhi koi size ya add-on group nahi hai.</div>';
  byId('menuOptionsGroupCount').textContent=attached.length+' groups';
 }
 async function refresh(){
  const ctx=safeContext(),ticket=++sequence;
  const [linksRes,groupsRes]=await Promise.all([
   deps.sb.from('menu_item_option_groups').select('restaurant_id,menu_item_id,option_group_id,is_available')
    .eq('restaurant_id',ctx.restaurantId).eq('menu_item_id',ctx.itemId),
   deps.sb.from('menu_option_groups').select('id,restaurant_id,name,min_select,max_select,is_available,sort_order')
    .eq('restaurant_id',ctx.restaurantId).order('sort_order')
  ]);
  if(linksRes.error)throw linksRes.error;
  if(groupsRes.error)throw groupsRes.error;
  const groupIds=(linksRes.data||[]).map(x=>x.option_group_id);
  let choicesRes={data:[],error:null};
  if(groupIds.length){
   choicesRes=await deps.sb.from('menu_option_choices')
    .select('id,restaurant_id,option_group_id,name,price_delta,is_available,sort_order')
    .eq('restaurant_id',ctx.restaurantId).in('option_group_id',groupIds).order('sort_order');
  }
  if(choicesRes.error)throw choicesRes.error;
  if(!selected||selected.restaurantId!==ctx.restaurantId||selected.itemId!==ctx.itemId||ticket!==sequence)return;
  linked=linksRes.data||[];groups=groupsRes.data||[];choices=choicesRes.data||[];
  render();
 }
 async function open(itemId){
  if(busy)return;
  const rid=deps?.getRestaurantId(),id=safeId(itemId);
  const item=id&&deps?.getMenuItems().find(x=>x.id===id);
  if(!rid||!id||!item||!deps.canEditRestaurant(rid)){
   feedback('Is restaurant ke menu items manage karne ki permission nahi hai.',true);return;
  }
  focusReturn=document.activeElement;
  selected={restaurantId:rid,itemId:id};
  linked=[];groups=[];choices=[];sequence++;
  byId('menuOptionsItemName').textContent=item.name;
  byId('menuOptionsModal').classList.add('show');
  byId('menuOptionsGroupForm').reset();
  byId('menuOptionsDraftChoices').innerHTML='';
  addDraftRow();
  render();
  feedback('Options load ho rahe hain…');
  byId('menuOptionsCloseBtn').focus({preventScroll:true});
  try{await refresh();feedback('Saved groups ko edit karein ya naya group banayein. Paid checkout abhi OFF hai.');}
  catch(error){feedback('Options load nahi hue: '+error.message,true);}
 }
 function close(){
  if(busy)return;
  selected=null;sequence++;
  byId('menuOptionsModal')?.classList.remove('show');
  if(focusReturn?.isConnected)focusReturn.focus({preventScroll:true});
 }
 async function createGroup(form){
  const ctx=safeContext();
  const options=validateDraftChoices(readDraftChoices());
  const payload=validateGroup(form.elements.name.value,form.elements.min_select.value,
    form.elements.max_select.value,options.length);
  let createdId=null;
  try{
   const g=await deps.sb.from('menu_option_groups')
    .insert({...payload,restaurant_id:ctx.restaurantId,is_available:false}).select('id').single();
   if(g.error)throw g.error;
   createdId=g.data?.id;
   if(!safeId(createdId))throw Error('Group ID could not be saved');
   const c=await deps.sb.from('menu_option_choices')
    .insert(options.map((choice,index)=>({...choice,restaurant_id:ctx.restaurantId,
      option_group_id:createdId,is_available:true,sort_order:index})));
   if(c.error)throw c.error;
   const m=await deps.sb.from('menu_item_option_groups')
    .insert({restaurant_id:ctx.restaurantId,menu_item_id:ctx.itemId,
      option_group_id:createdId,is_available:false});
   if(m.error)throw m.error;
  }catch(e){
   // Incomplete groups are created paused and do not become customer-selectable.
   // Clean up only a newly-created, never-activated group from this request.
   if(createdId){
    const cleanup=await deps.sb.from('menu_option_groups')
     .delete().eq('id',createdId).eq('restaurant_id',ctx.restaurantId).eq('is_available',false);
    if(cleanup.error)throw Error(e.message+' (Incomplete paused group cleanup failed; contact support.)');
   }
   throw e;
  }
  form.reset();
  byId('menuOptionsDraftChoices').innerHTML='';
  addDraftRow();
  await refresh();
  feedback('Group aur saare choices save ho gaye. Review karke Enable for this dish dabayein.');
 }
 async function saveGroup(form){
  const ctx=safeContext(),id=safeId(form.dataset.groupId);
  if(!id||!linked.some(x=>x.option_group_id===id))throw Error('Unknown group');
  const available=choices.filter(x=>x.option_group_id===id&&x.is_available).length;
  const data=validateGroup(form.elements.name.value,form.elements.min_select.value,
    form.elements.max_select.value);
  if(data.min_select>available)throw Error('Min selection se kam active choices hain.');
  const r=await deps.sb.from('menu_option_groups').update({...data,updated_at:new Date().toISOString()})
   .eq('id',id).eq('restaurant_id',ctx.restaurantId);
  if(r.error)throw r.error;
  await refresh();feedback('Group settings save ho gayi.');
 }
 async function addChoice(form){
  const ctx=safeContext(),gid=safeId(form.dataset.groupId);
  if(!gid||!linked.some(x=>x.option_group_id===gid))throw Error('Unknown option group');
  const data=validateChoice(form.elements.name.value,form.elements.price_delta.value);
  const existing=choices.filter(x=>x.option_group_id===gid);
  if(existing.length>=MAX_CHOICES_PER_GROUP)throw Error('Maximum 30 choices per group.');
  if(existing.some(c=>c.name.toLowerCase()===data.name.toLowerCase()))throw Error('Same choice already exists.');
  const r=await deps.sb.from('menu_option_choices').insert({...data,
    restaurant_id:ctx.restaurantId,option_group_id:gid,is_available:true,sort_order:existing.length});
  if(r.error)throw r.error;
  await refresh();feedback('Naya choice save ho gaya.');
 }
 async function editChoice(form){
  const ctx=safeContext(),id=safeId(form.dataset.choiceId);
  if(!id||!choices.some(x=>x.id===id))throw Error('Unknown option choice');
  const data=validateChoice(form.elements.name.value,form.elements.price_delta.value);
  const existing=choices.find(c=>c.id===id);
  if(choices.some(c=>c.id!==id&&c.option_group_id===existing.option_group_id
      &&c.name.toLowerCase()===data.name.toLowerCase()))throw Error('Same choice already exists.');
  const r=await deps.sb.from('menu_option_choices').update({...data,updated_at:new Date().toISOString()})
   .eq('id',id).eq('restaurant_id',ctx.restaurantId).eq('option_group_id',existing.option_group_id);
  if(r.error)throw r.error;
  await refresh();feedback('Choice aur uska charge save ho gaya.');
 }
 async function toggleChoice(id){
  const ctx=safeContext(),choice=choices.find(c=>c.id===id);
  if(!choice)throw Error('Unknown choice');
  if(choice.is_available){
   const g=groups.find(x=>x.id===choice.option_group_id);
   const remaining=choices.filter(c=>c.option_group_id===choice.option_group_id&&c.is_available&&c.id!==id).length;
   if(g&&remaining<g.min_select)throw Error('Minimum required choices se kam ho jayenge. Pehle group min selection badlein.');
  }
  const r=await deps.sb.from('menu_option_choices')
   .update({is_available:!choice.is_available,updated_at:new Date().toISOString()})
   .eq('id',id).eq('restaurant_id',ctx.restaurantId);
  if(r.error)throw r.error;
  await refresh();feedback('Choice availability update ho gayi.');
 }
 async function toggleLink(id){
  const ctx=safeContext(),group=groups.find(g=>g.id===id),link=linked.find(x=>x.option_group_id===id);
  if(!group||!link)throw Error('Unknown group');
  const active=group.is_available&&link.is_available;
  if(!active){
   const ready=choices.filter(c=>c.option_group_id===id&&c.is_available).length;
   if(!ready||ready<group.min_select)throw Error('Group enable karne se pehle required options add karein.');
   if(!group.is_available){
    const g=await deps.sb.from('menu_option_groups').update({is_available:true,updated_at:new Date().toISOString()})
      .eq('id',id).eq('restaurant_id',ctx.restaurantId);
    if(g.error)throw g.error;
   }
  }
  const r=await deps.sb.from('menu_item_option_groups').update({is_available:!active})
   .eq('restaurant_id',ctx.restaurantId).eq('menu_item_id',ctx.itemId).eq('option_group_id',id);
  if(r.error)throw r.error;
  await refresh();
  feedback(active?'Is dish ke options pause ho gaye.':'Options is dish ke liye configured hain. Customer paid checkout abhi OFF hai.');
 }
 async function run(task){
  if(busy)return;
  try{
   setBusy(true);feedback('Saving…');
   await task();
  }catch(error){feedback('Save nahi hua: '+(error?.message||String(error)),true);}
  finally{setBusy(false);}
 }
 function init(config){
  if(deps)return;
  if(!config?.sb||typeof config.getRestaurantId!=='function'
    ||typeof config.getMenuItems!=='function'||typeof config.canEditRestaurant!=='function')
   throw Error('Owner menu option manager configuration incomplete');
  deps=config;
  const modal=byId('menuOptionsModal');
  if(!modal)throw Error('Owner menu options modal missing');
  byId('menuOptionsCloseBtn').addEventListener('click',close);
  byId('menuOptionsAddDraftChoice').addEventListener('click',()=>{if(!busy)addDraftRow();});
  modal.addEventListener('click',event=>{
   const button=event.target.closest('[data-options-action]');
   if(!button||busy)return;
   const action=button.dataset.optionsAction;
   if(action==='remove-draft'){
    const rows=byId('menuOptionsDraftChoices').querySelectorAll('.bite-option-draft-row');
    if(rows.length>1)button.closest('.bite-option-draft-row')?.remove();
    else feedback('Kam se kam ek choice required hai.',true);
    return;
   }
   if(action==='link-toggle')run(()=>toggleLink(button.dataset.groupId));
   if(action==='choice-toggle')run(()=>toggleChoice(button.dataset.choiceId));
  });
  modal.addEventListener('submit',event=>{
   const form=event.target.closest('form[data-options-form],#menuOptionsGroupForm');
   if(!form)return;
   event.preventDefault();
   if(form.id==='menuOptionsGroupForm')run(()=>createGroup(form));
   if(form.dataset.optionsForm==='group-edit')run(()=>saveGroup(form));
   if(form.dataset.optionsForm==='choice-add')run(()=>addChoice(form));
   if(form.dataset.optionsForm==='choice-edit')run(()=>editChoice(form));
  });
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&modal.classList.contains('show')&&!busy)close();
  });
 }
 return {init,open,close,refresh,validateGroup,validateChoice,validateDraftChoices};
});
