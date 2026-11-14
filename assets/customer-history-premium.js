/* Client-only history filters over already loaded, customer-owned order cards. */
(function(){
 'use strict';
 const toolbar=document.getElementById('biteHistoryToolbar');
 const input=document.getElementById('biteHistorySearch');
 const list=document.getElementById('ordersList');
 const count=document.getElementById('biteHistoryCount');
 const empty=document.getElementById('biteHistoryNoMatches');
 if(!toolbar||!input||!list||!count||!empty)return;
 let activeFilter='all';
 const active=new Set(['pending','confirmed','received','accepted','preparing','ready','handed over','out for delivery']);
 const completed=new Set(['completed','delivered']);
 const cancelled=new Set(['cancelled','canceled','rejected']);
 const norm=value=>String(value||'').trim().toLocaleLowerCase('en-IN').replace(/\s+/g,' ');
 function groupFor(status){
  const value=norm(status);
  if(active.has(value))return 'active';
  if(completed.has(value))return 'completed';
  if(cancelled.has(value))return 'cancelled';
  return 'other';
 }
 function applyFilters(){
  const cards=Array.from(list.querySelectorAll(':scope > .ordercard'));
  const term=norm(input.value);
  let visible=0;
  for(const card of cards){
   const code=norm(card.querySelector('.ordercode')?.textContent);
   const restaurant=norm(card.querySelector('.orderrestaurant')?.textContent);
   const status=card.querySelector('.orderstatus')?.textContent||'';
   const matching=(activeFilter==='all'||groupFor(status)===activeFilter)
    &&(!term||code.includes(term)||restaurant.includes(term));
   card.hidden=!matching;
   if(matching)visible++;
  }
  count.textContent=cards.length?'Showing '+visible+' of '+cards.length+' orders':'';
  // Preserve server-owned loading, error and genuinely empty-order states.
  empty.hidden=!cards.length||visible>0;
  return {visible,total:cards.length};
 }
 function setFilter(next){
  activeFilter=next;
  toolbar.querySelectorAll('[data-bite-history-filter]').forEach(button=>{
   button.setAttribute('aria-pressed',String(button.dataset.biteHistoryFilter===next));
  });
  applyFilters();
 }
 toolbar.addEventListener('click',event=>{
  const button=event.target.closest('button[data-bite-history-filter]');
  if(button)setFilter(button.dataset.biteHistoryFilter||'all');
 });
 input.addEventListener('input',applyFilters);
 empty.querySelector('button')?.addEventListener('click',()=>{
  input.value='';
  setFilter('all');
  input.focus({preventScroll:true});
 });
 window.BiteHistoryPremium={applyFilters,groupFor};
})();