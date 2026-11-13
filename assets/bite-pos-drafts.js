/* Bite POS drafts — owner-specific, restaurant-specific, autosaved locally and to Supabase.
   Drafts are NOT orders, payments or sales. Posted orders have separate guarded workflows. */
(function(){
'use strict';
let ctx=null,activeId=null,suspend=false,saveTimer=null,cloudBusy=false;
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function identity(){
 const u=ctx?.getUser(),a=ctx?.getAccess();
 return u&&a?.role==='owner'&&a.restaurantId?{uid:u.id,restaurantId:a.restaurantId}:null;
}
function cacheKey(ident){return 'bite_pos_drafts_v2:'+ident.uid+':'+ident.restaurantId}
function readCache(ident){
 try{const data=JSON.parse(localStorage.getItem(cacheKey(ident))||'[]');return Array.isArray(data)?data.filter(x=>x&&x.id&&x.restaurant_id===ident.restaurantId).slice(0,40):[]}
 catch{return []}
}
function writeCache(ident,rows){try{localStorage.setItem(cacheKey(ident),JSON.stringify(rows.slice(0,40)));return true}catch{return false}}
function setStatus(label){const el=$('posDraftStatus');if(el)el.textContent=label}
function fields(){
 const f=$('orderForm');if(!f)return null;
 return {
  customerName:($('orderCustomerName')?.value||'').trim(),
  customerPhone:($('orderCustomerPhone')?.value||'').trim(),
  channel:'POS - Counter',
  items:[...document.querySelectorAll('#orderItemRows .order-item-row')].map(row=>({
   name:row.querySelector('.item-name').value.trim(),
   quantity:Number(row.querySelector('.item-quantity').value),
   unit_price:Number(row.querySelector('.item-price').value),
   menuItemId:row.querySelector('.item-price').dataset.menuItemId||null
  })),
  pickerName:$('posPickerItemName')?.value||'',pickerQuantity:$('posPickerQuantity')?.value||'1',
  pickerPrice:$('posPickerPrice')?.value||'',
  paidAmount:$('posPaidAmount')?.value||'',paymentMethod:f.elements.payment_method?.value||'Cash',
  paymentDate:f.elements.payment_date?.value||'',paymentReference:f.elements.payment_reference?.value||'',
  balanceAction:f.elements.balance_action?.value||'udhar',
  whatsAppConsent:!!$('posWhatsAppConsent')?.checked,
  replaceOrderId:$('posReplaceOrderId')?.value||''
 };
}
function hasContent(p){return !!(p.customerName||p.customerPhone||p.items.length||p.pickerName||p.paidAmount||p.paymentReference||p.replaceOrderId)}
function remember(id,payload){
 const ident=identity();if(!ident||!id)return null;
 const list=readCache(ident).filter(d=>d.id!==id);
 const rec={id,restaurant_id:ident.restaurantId,created_by:ident.uid,payload,updated_at:new Date().toISOString(),dirty:true};
 list.unshift(rec);writeCache(ident,list);renderDrafts();return rec;
}
function markClean(ident,id,version){
 const list=readCache(ident);
 const index=list.findIndex(x=>x.id===id);
 if(index<0||list[index].updated_at!==version)return;
 list[index].dirty=false;writeCache(ident,list);renderDrafts();
}
async function syncOne(rec){
 const ident=identity();
 if(!ident||rec.restaurant_id!==ident.restaurantId||rec.created_by!==ident.uid)return;
 const {error}=await ctx.sb.from('restaurant_pos_drafts').upsert({
  id:rec.id,restaurant_id:ident.restaurantId,created_by:ident.uid,payload:rec.payload
 },{onConflict:'id'});
 if(error)throw error;
 markClean(ident,rec.id,rec.updated_at);
}
async function syncPending(){
 if(cloudBusy||!identity())return;
 cloudBusy=true;
 try{
  const list=readCache(identity()).filter(d=>d.dirty);
  for(const rec of list){
   try{await syncOne(rec);if(activeId===rec.id)setStatus('Draft saved securely ✓')}
   catch(err){if(activeId===rec.id)setStatus('Draft saved on this device; cloud pending');console.warn('POS draft cloud sync failed:',err.message)}
  }
 }finally{cloudBusy=false}
}
function touch(){
 if(suspend||!activeId||!identity()||!$('orderModal')?.classList.contains('show'))return;
 const payload=fields();
 if(!payload||!hasContent(payload))return;
 const rec=remember(activeId,payload);
 if(rec)setStatus('Draft saved on this device · syncing...');
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void syncPending()},650);
}
async function saveNow(){
 touch();clearTimeout(saveTimer);await syncPending();
 if(!activeId){setStatus('Add an item or customer detail to save a draft');return}
 const ident=identity(),r=ident&&readCache(ident).find(x=>x.id===activeId);
 if(r)setStatus(r.dirty?'Saved on this device (cloud pending)':'Draft saved ✓');
}
function newBill(){
 clearTimeout(saveTimer);activeId=crypto.randomUUID();
 if($('posReplaceOrderId'))$('posReplaceOrderId').value='';
 if($('orderModalTitle'))$('orderModalTitle').textContent='New POS Bill';
 setStatus('Auto-save enabled · add items to create a draft');
}
function fill(data){
 const f=$('orderForm');if(!f)return;
 suspend=true;
 try{
  $('orderCustomerName').value=data.customerName||'';
  $('orderCustomerPhone').value=data.customerPhone||'';
  $('orderItemRows').innerHTML='';
  for(const x of data.items||[]){
   if(!x.name||!(Number(x.quantity)>0)||!(Number(x.unit_price)>=0))continue;
   window.addOrderItemRow({name:x.name,quantity:Number(x.quantity),price:Number(x.unit_price),menuItemId:x.menuItemId||null});
  }
  $('posPickerItemName').value=data.pickerName||'';
  $('posPickerQuantity').value=data.pickerQuantity||'1';
  $('posPickerPrice').value=data.pickerPrice||'';
  $('posPaidAmount').value=data.paidAmount||'';
  f.elements.payment_method.value=data.paymentMethod||'Cash';
  f.elements.payment_date.value=data.paymentDate||'';
  f.elements.payment_reference.value=data.paymentReference||'';
  f.elements.balance_action.value=data.balanceAction||'udhar';
  $('posWhatsAppConsent').checked=!!data.whatsAppConsent;
  $('posReplaceOrderId').value=data.replaceOrderId||'';
  window.renderPosItemSummary();window.updateOrderTotal();
  if($('orderModalTitle'))$('orderModalTitle').textContent=data.replaceOrderId?'Edit unpaid POS bill':'Continue POS Draft';
 }finally{suspend=false}
}
async function openDraft(id){
 const ident=identity();if(!ident)return;
 let rec=readCache(ident).find(x=>x.id===id);
 if(!rec){const r=await ctx.sb.from('restaurant_pos_drafts').select('*').eq('id',id).eq('restaurant_id',ident.restaurantId).maybeSingle();if(r.error)throw r.error;rec=r.data}
 if(!rec||rec.restaurant_id!==ident.restaurantId||rec.created_by!==ident.uid){alert('Draft not found for your restaurant.');return}
 await window.openOrder();
 activeId=rec.id;fill(rec.payload||{});
 setStatus(rec.dirty?'Draft restored · cloud sync pending':'Draft restored ✓');
}
async function discardDraft(id){
 const ident=identity();if(!ident)return;
 if(!confirm('Ye draft permanently delete karein? Saved POS bill par iska asar nahi hoga.'))return;
 const {error}=await ctx.sb.from('restaurant_pos_drafts').delete().eq('id',id).eq('restaurant_id',ident.restaurantId).eq('created_by',ident.uid);
 if(error){alert('Cloud se draft delete nahi hua: '+error.message+' · internet check karein.');return}
 writeCache(ident,readCache(ident).filter(d=>d.id!==id));
 if(activeId===id){activeId=null;window.closeModal('orderModal')}
 renderDrafts();setStatus('Draft deleted');
}
async function discardActive(){if(activeId)await discardDraft(activeId);else window.closeModal('orderModal')}
async function finishOrder(){
 clearTimeout(saveTimer);
 const id=activeId,ident=identity();activeId=null;
 if(!id||!ident)return;
 writeCache(ident,readCache(ident).filter(x=>x.id!==id));
 renderDrafts();
 const {error}=await ctx.sb.from('restaurant_pos_drafts').delete().eq('id',id).eq('restaurant_id',ident.restaurantId).eq('created_by',ident.uid);
 if(error)console.warn('Completed POS draft cleanup pending:',error.message);
}
function currentOrderCode(){return activeId?'POS-'+activeId.replace(/-/g,'').slice(0,24).toUpperCase():null}
async function refreshDrafts(){
 const ident=identity();if(!ident)return;
 let local=readCache(ident),list=local.slice();
 const r=await ctx.sb.from('restaurant_pos_drafts').select('id,restaurant_id,created_by,payload,updated_at')
  .eq('restaurant_id',ident.restaurantId).eq('created_by',ident.uid).order('updated_at',{ascending:false}).limit(40);
 if(r.error){console.warn('Draft list unavailable:',r.error.message);renderDrafts();return}
 for(const remote of r.data||[]){
  const idx=list.findIndex(x=>x.id===remote.id);
  if(idx<0)list.push({...remote,dirty:false});
  else if(!list[idx].dirty&&new Date(remote.updated_at)>new Date(list[idx].updated_at))list[idx]={...remote,dirty:false};
 }
 list.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
 writeCache(ident,list);
 renderDrafts();void syncPending();
}
function renderDrafts(){
 const box=$('posDraftCards'),ident=identity();if(!box)return;
 if(!ident){box.textContent='Owner login required';return}
 const list=readCache(ident);
 if(!list.length){box.innerHTML='<span class="small">Koi draft nahi. New POS Bill bharte hi automatically save hoga.</span>';return}
 box.innerHTML=list.map(d=>{
  const p=d.payload||{},items=Array.isArray(p.items)?p.items:[],total=items.reduce((n,i)=>n+Number(i.quantity||0)*Number(i.unit_price||0),0);
  const title=escapeHtml(p.customerName||p.customerPhone||'Walk-in customer');
  return '<div class="pos-draft-card"><div><strong>'+title+'</strong><div class="small">'+items.length+' items · '+total.toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2})+' · '+escapeHtml(new Date(d.updated_at).toLocaleString('en-IN'))+'</div><div class="small">'+(d.dirty?'Saved on device · syncing':'Cloud saved ✓')+'</div></div><div class="pos-draft-actions"><button type="button" class="btn secondary" data-pos-draft-open="'+escapeHtml(d.id)+'">Edit / Resume</button><button type="button" class="btn secondary" data-pos-draft-delete="'+escapeHtml(d.id)+'">Delete</button></div></div>';
 }).join('');
}
async function editSavedPos(orderId){
 const a=ctx?.getAccess(),s=ctx?.getState(),o=s?.orders.find(x=>x.id===orderId);
 if(!o||o.restaurant!==a?.restaurantId||o.channel!=='POS - Counter'||o.isDemo||o.status!=='Received'||o.waivedOffAmount>0||s.orderPayments.some(p=>p.order_id===orderId)||s.orderRefunds.some(x=>x.order_id===orderId)){alert('Sirf open aur unpaid POS bill edit ho sakta hai. Paid bill ke liye refund/correction record use karein.');return}
 const items=s.orderItems.filter(x=>x.order_id===orderId).map(x=>({name:x.item_name,quantity:Number(x.quantity),unit_price:Number(x.unit_price),menuItemId:x.menu_item_id||null}));
 if(!items.length){alert('Bill items load nahi huye. Refresh karein.');return}
 await window.openOrder();
 fill({customerName:o.customerName,customerPhone:o.customerPhone,items,replaceOrderId:orderId,paidAmount:'0',balanceAction:'udhar'});
 touch();setStatus('Correction draft saved automatically · original bill replaces only on Save');
}
async function voidSavedPos(orderId){
 const a=ctx?.getAccess(),s=ctx?.getState(),o=s?.orders.find(x=>x.id===orderId);
 if(!o||o.restaurant!==a?.restaurantId||o.status!=='Received'||o.channel!=='POS - Counter'||o.waivedOffAmount>0||s.orderPayments.some(p=>p.order_id===orderId)||s.orderRefunds.some(x=>x.order_id===orderId)){alert('Paid, closed or marketplace bills cannot be deleted. Use refund/correction process.');return}
 if(!confirm('Is unpaid POS bill ko VOID karein? Bill history mein Cancelled dikhega; audit record delete nahi hoga.'))return;
 const {error}=await ctx.sb.rpc('void_unpaid_pos_order',{p_order_id:orderId,p_reason:'Voided by restaurant owner'});
 if(error){alert('Bill void nahi hua: '+error.message);return}
 await window.loadCloudData();alert('Unpaid bill void ho gaya; history aur audit safe hain.');
}
function init(settings){
 if(ctx)return;ctx=settings;
 const f=$('orderForm');
 f?.addEventListener('input',touch);f?.addEventListener('change',touch);
 $('posDraftCards')?.addEventListener('click',event=>{
  const open=event.target.closest('[data-pos-draft-open]'),del=event.target.closest('[data-pos-draft-delete]');
  if(open)void openDraft(open.dataset.posDraftOpen).catch(err=>alert('Draft open nahi hua: '+err.message));
  if(del)void discardDraft(del.dataset.posDraftDelete);
 });
 window.addEventListener('online',()=>void syncPending());
}
window.BitePOS={init,newBill,touch,saveNow,openDraft,discardDraft,discardActive,finishOrder,currentOrderCode,refreshDrafts,renderDrafts,editSavedPos,voidSavedPos};
})();
