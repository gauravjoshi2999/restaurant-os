/* Bite customer privacy export.
 * Read-only authenticated snapshot: no service keys, no payment-provider claims.
 * Existing Supabase RLS and customer-owned RPC remain authoritative.
 */
(function(root){
'use strict';
const own=(source,keys)=>Object.fromEntries(keys.filter(k=>Object.prototype.hasOwnProperty.call(source||{},k)).map(k=>[k,source[k]]));
const ADDRESS_FIELDS=['label','recipient_name','recipient_phone','address_line','landmark','city','state','postal_code','is_default'];
const TICKET_FIELDS=['category','subject','message','status','admin_response','created_at'];
const ORDER_FIELDS=['order_code','restaurant_name','order_date','delivery_type','status','amount'];
function assertCurrent(current){if(typeof current==='function'&&!current())throw new Error('Account changed. Please reopen your account and try again.');}
async function ensureIdentity(sb,id,current){
 assertCurrent(current);
 const result=await sb.auth.getUser();
 if(result.error)throw result.error;
 if(!result.data?.user||result.data.user.id!==id)throw new Error('Account changed. Please reopen your account and try again.');
 assertCurrent(current);
 return result.data.user;
}
async function buildSnapshot(sb,id,current=()=>true){
 if(!id||typeof id!=='string')throw new Error('Please sign in to download your account data.');
 const startUser=await ensureIdentity(sb,id,current);
 // No data from unscoped table reads; authenticated RLS and customer_id filters both apply.
 const [contact,address,tickets,orders]=await Promise.all([
   sb.from('customer_contact_profiles').select('full_name,phone').eq('customer_id',id).maybeSingle(),
   sb.from('customer_addresses').select(ADDRESS_FIELDS.join(',')).eq('customer_id',id).order('created_at',{ascending:false}).limit(500),
   sb.from('customer_support_tickets').select(TICKET_FIELDS.join(',')).eq('customer_id',id).order('created_at',{ascending:false}).limit(500),
   sb.rpc('list_my_customer_orders')
 ]);
 assertCurrent(current);
 for(const response of [contact,address,tickets,orders]){
   if(response.error)throw new Error('Some account information could not be loaded. Please try again. No partial export was created.');
 }
 const verified=await ensureIdentity(sb,id,current);
 if(startUser.id!==verified.id)throw new Error('Account changed during export.');
 const addresses=(address.data||[]).map(row=>own(row,ADDRESS_FIELDS));
 const ticketsList=(tickets.data||[]).map(row=>own(row,TICKET_FIELDS));
 const history=(orders.data||[]).map(row=>own(row,ORDER_FIELDS));
 assertCurrent(current);
 return {
   format:'bite-customer-data-snapshot',schema_version:1,exported_at:new Date().toISOString(),
   note:'Personal account snapshot. Orders reflect history available from My Orders. Includes up to 500 recent support requests and addresses. Does not include payment gateway records or complete statutory data archives.',
   account:{id:verified.id,email:verified.email||'',full_name:contact.data?.full_name||verified.user_metadata?.full_name||'',phone:contact.data?.phone||null},
   preferences:{vegetarian_mode:verified.user_metadata?.bite_preferences_v1?.veg_only===true},
   saved_addresses:addresses,support_requests:ticketsList,order_history:history
 };
}
function downloadSnapshot(snapshot,documentRef=root?.document,URLRef=root?.URL){
 if(!documentRef||!URLRef?.createObjectURL||!root?.Blob)throw new Error('Downloads are not available in this browser.');
 const output=new root.Blob([JSON.stringify(snapshot,null,2)+'\n'],{type:'application/json;charset=utf-8'});
 const uri=URLRef.createObjectURL(output);
 try{
   const link=documentRef.createElement('a');
   link.href=uri;link.download='bite-account-data-'+snapshot.exported_at.slice(0,10)+'.json';
   link.style.display='none';
   documentRef.body.appendChild(link);link.click();link.remove();
 }finally{
   // Keep the download URL valid long enough for mobile browsers to start transfer.
   root.setTimeout(()=>URLRef.revokeObjectURL(uri),1500);
 }
}
const api={buildSnapshot,downloadSnapshot};
if(root)root.BiteAccountExport=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
