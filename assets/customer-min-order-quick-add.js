/* Bite checkout minimum order: restaurant-scoped quick add, no new payment path. */
(function(){
  'use strict';

  function foodSubtotal(items, quantities){
    return (items||[]).reduce((total,item)=>total+Math.max(0,Number(item.price)||0)*Math.max(0,Number(quantities?.[item.id])||0),0);
  }
  function amountRemaining(minimum, subtotal){
    return Math.max(0,Math.round((Math.max(0,Number(minimum)||0)-Math.max(0,Number(subtotal)||0))*100)/100);
  }
  function recommend(items, quantities, remaining, search=''){
    const query=String(search||'').trim().toLocaleLowerCase();
    const eligible=(items||[]).filter(item=>item&&item.id&&Number(item.price)>0&&
      Number(quantities?.[item.id]||0)<99&&
      (!query||String(item.name||'').toLocaleLowerCase().includes(query)));
    if(query)return eligible.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).slice(0,12);
    const need=Math.max(1,Number(remaining)||1);
    const allVeg=Object.entries(quantities||{}).some(([,q])=>Number(q)>0)&&
      Object.entries(quantities||{}).filter(([,q])=>Number(q)>0)
        .every(([id])=>items.find(i=>i.id===id)?.is_vegetarian===true);
    const score=item=>{
      const price=Number(item.price);
      const difference=price>=need?(price-need):(need-price)+Math.min(need,40);
      return difference+(Number(quantities?.[item.id]||0)>0?10:0)+
        (allVeg&&item.is_vegetarian===false?60:0);
    };
    return eligible.sort((a,b)=>score(a)-score(b)||Number(a.price)-Number(b.price)).slice(0,8);
  }

  if(typeof module!=='undefined'&&module.exports){
    module.exports={foodSubtotal,amountRemaining,recommend};
  }
  if(typeof document==='undefined')return;

  const error=document.getElementById('checkoutError');
  const form=document.getElementById('checkoutFormPanel');
  if(!error||!form)return;
  const panel=document.createElement('section');
  panel.id='biteMinimumQuickAdd';
  panel.className='bite-min-order';
  panel.hidden=true;
  panel.setAttribute('aria-labelledby','biteMinOrderHeading');
  panel.innerHTML=
    '<div class="bite-min-order-top">'+
      '<div><span class="bite-min-order-eyebrow">YOUR ORDER</span>'+
        '<h3 id="biteMinOrderHeading" tabindex="-1">A little more to go</h3>'+
        '<p id="biteMinOrderMessage">Add a dish to reach the minimum.</p></div>'+
      '<span class="bite-min-order-count" id="biteMinOrderCount"></span>'+
    '</div>'+
    '<div class="bite-min-order-track" role="progressbar" id="biteMinOrderProgress" aria-label="Minimum food order progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="biteMinOrderProgressFill"></span></div>'+
    '<div class="bite-min-order-totals"><span id="biteMinOrderSubtotal"></span><strong id="biteMinOrderMinimum"></strong></div>'+
    '<div class="bite-min-order-picks" id="biteMinOrderPicks">'+
      '<div class="bite-min-order-chooser"><div><strong>Quick add from this menu</strong><small>Tap + to add a dish</small></div>'+
        '<label class="bite-min-order-search"><span aria-hidden="true">⌕</span><input type="search" id="biteMinOrderSearch" placeholder="Search dishes" aria-label="Find a dish to add" autocomplete="off"></label></div>'+
      '<div class="bite-min-order-dishes" id="biteMinOrderDishes" aria-label="Dishes available from this restaurant"></div>'+
    '</div>'+
    '<p class="bite-min-order-feedback" id="biteMinOrderFeedback" role="status" aria-live="polite"></p>'+
    '<div class="bite-min-order-footer"><strong id="biteMinOrderFooterTotal"></strong>'+
      '<button type="button" id="biteMinOrderContinue" disabled>Add more dishes</button></div>';

  error.insertAdjacentElement('afterend',panel);
  const byId=id=>document.getElementById(id);
  const state={restaurantId:null,pin:null,mode:null,minimum:0,fee:0,zoneName:'',open:false};
  const currentSubtotal=()=>foodSubtotal(menuItems,cart);
  const pendingPayment=()=>typeof pendingLiveCheckout!=='undefined'&&!!pendingLiveCheckout;
  const isCurrent=()=>!!activeRestaurant&&activeRestaurant.id===state.restaurantId&&checkoutMode()===state.mode&&
    (state.mode!=='delivery'||byId('addressPostal').value.trim()===state.pin);

  function hide(){
    state.open=false;
    panel.hidden=true;
    byId('biteMinOrderSearch').value='';
    byId('biteMinOrderFeedback').textContent='';
  }

  function makeButton(label,action,id,disabled){
    const button=document.createElement('button');
    button.type='button';
    button.dataset.biteMinAction=action;
    button.dataset.biteMinItem=id;
    button.textContent=label;
    button.disabled=!!disabled;
    button.setAttribute('aria-label',(action==='add'?'Add one ':'Remove one ')+
      (menuItems.find(item=>item.id===id)?.name||'dish'));
    return button;
  }

  function renderChoices(){
    const list=byId('biteMinOrderDishes');
    const chosen=recommend(menuItems,cart,amountRemaining(state.minimum,currentSubtotal()),byId('biteMinOrderSearch').value);
    list.replaceChildren();
    if(!chosen.length){
      const empty=document.createElement('p');empty.className='bite-min-order-empty';
      empty.textContent=byId('biteMinOrderSearch').value.trim()?'No matching dishes. Try another name.':'No more dishes available to add. Edit items or contact the restaurant.';
      list.append(empty);
      return;
    }
    for(const item of chosen){
      const article=document.createElement('article');
      article.className='bite-min-order-dish';
      const image=document.createElement('img');
      image.src=window.BiteDiscovery?.safeImage?.(item.image_url,'assets/food-placeholder.svg')||
        'assets/food-placeholder.svg';
      image.alt='';image.loading='lazy';image.decoding='async';
      image.addEventListener('error',()=>{
        if(!image.src.endsWith('/assets/food-placeholder.svg'))image.src='assets/food-placeholder.svg';
      },{once:true});
      const info=document.createElement('div');
      info.className='bite-min-order-dish-info';
      const name=document.createElement('strong');name.textContent=item.name||'Dish';
      const price=document.createElement('small');price.textContent=money(item.price);
      info.append(name,price);
      const qty=Math.max(0,Number(cart[item.id]||0));
      const actions=document.createElement('div');actions.className='bite-min-order-qty';
      if(qty){
        actions.append(makeButton('−','remove',item.id,pendingPayment()));
        const quantity=document.createElement('span');quantity.textContent=String(qty);
        quantity.setAttribute('aria-label',qty+' in cart');
        actions.append(quantity);
      }
      actions.append(makeButton(qty?'+':'+ Add','add',item.id,qty>=99||pendingPayment()));
      article.append(image,info,actions);
      list.append(article);
    }
  }

  function render(){
    if(!state.open||!isCurrent()){hide();return;}
    const subtotal=currentSubtotal();
    const remaining=amountRemaining(state.minimum,subtotal);
    const complete=remaining<=0;
    const percent=state.minimum>0?Math.min(100,Math.round(100*subtotal/state.minimum)):100;
    byId('biteMinOrderHeading').textContent=complete?'Minimum reached ✓':'Add '+money(remaining)+' more';
    byId('biteMinOrderMessage').textContent=complete
      ?'Great! Your cart is ready for the next step.'
      :'Add something from '+(activeRestaurant?.name||'this restaurant')+' without leaving checkout.';
    byId('biteMinOrderCount').textContent=complete?'Ready':'MIN '+money(state.minimum);
    byId('biteMinOrderProgress').setAttribute('aria-valuenow',String(percent));
    byId('biteMinOrderProgressFill').style.width=percent+'%';
    byId('biteMinOrderSubtotal').textContent='Food total '+money(subtotal);
    byId('biteMinOrderMinimum').textContent='Minimum '+money(state.minimum);
    byId('biteMinOrderFooterTotal').textContent=complete?'Food total '+money(subtotal):money(remaining)+' to go';
    byId('biteMinOrderPicks').hidden=complete;
    const continueButton=byId('biteMinOrderContinue');
    continueButton.disabled=!complete||pendingPayment();
    continueButton.textContent=complete?'Continue to payment →':'Add '+money(remaining)+' more';
    panel.classList.toggle('is-complete',complete);
    if(!complete)renderChoices();
  }

  function open(details,options={}){
    if(!details||!activeRestaurant||Number(details.minimum||details.required)<=0||pendingPayment()){
      hide();return;
    }
    const minimum=Number(details.minimum||details.required);
    const mode=checkoutMode();
    const pin=mode==='delivery'?byId('addressPostal').value.trim():null;
    const changed=state.restaurantId!==activeRestaurant.id||state.pin!==pin||state.mode!==mode;
    state.restaurantId=activeRestaurant.id;
    state.mode=mode;
    state.pin=pin;
    state.minimum=minimum;
    state.fee=Number(details.deliveryFee??details.zone?.delivery_fee??(mode==='delivery'?activeRestaurant.default_delivery_fee:0))||0;
    state.zoneName=details.zoneName||'';
    state.open=true;
    if(changed)byId('biteMinOrderSearch').value='';
    panel.hidden=false;
    render();
    if(options.focus){
      panel.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
      byId('biteMinOrderHeading').focus({preventScroll:true});
    }
  }

  byId('biteMinOrderSearch').addEventListener('input',render);
  byId('biteMinOrderDishes').addEventListener('click',event=>{
    const button=event.target.closest('button[data-bite-min-action]');
    if(!button||button.disabled||!state.open||!isCurrent()||pendingPayment())return;
    const item=menuItems.find(i=>i.id===button.dataset.biteMinItem);
    if(!item||!Number.isFinite(Number(item.price))||Number(item.price)<=0)return;
    const oldQty=Number(cart[item.id]||0);
    const nextQty=button.dataset.biteMinAction==='add'?Math.min(99,oldQty+1):Math.max(0,oldQty-1);
    if(oldQty===nextQty)return;
    if(typeof hideCartUndo==='function')hideCartUndo();
    if(nextQty)cart[item.id]=nextQty;
    else {delete cart[item.id];if(typeof itemNotes!=='undefined')delete itemNotes[item.id];}
    renderCart();
    if(typeof refreshMenuQuantityControl==='function')refreshMenuQuantityControl(item.id);
    byId('checkoutRestaurant').textContent=activeRestaurant.name+' • '+
      cartEntries().reduce((total,[,q])=>total+q,0)+' items';
    renderCheckoutSummary(state.fee);
    const focused={id:item.id,action:button.dataset.biteMinAction};
    render();
    const replacement=Array.from(byId('biteMinOrderDishes').querySelectorAll('button[data-bite-min-action]'))
      .find(next=>next.dataset.biteMinItem===focused.id&&next.dataset.biteMinAction===focused.action&&!next.disabled);
    if(replacement)replacement.focus({preventScroll:true});
    else if(amountRemaining(state.minimum,currentSubtotal())===0)byId('biteMinOrderContinue').focus({preventScroll:true});
    byId('biteMinOrderFeedback').textContent=item.name+
      (nextQty>oldQty?' added. ':' updated. ')+
      (amountRemaining(state.minimum,currentSubtotal())===0?'Minimum reached. You can continue.':money(amountRemaining(state.minimum,currentSubtotal()))+' more needed.');
    // Server remains the sole source of delivery-zone fees and minimums.
    if(typeof refreshCheckoutZoneEstimate==='function')void refreshCheckoutZoneEstimate();
  });
  byId('biteMinOrderContinue').addEventListener('click',()=>{
    if(byId('biteMinOrderContinue').disabled||pendingPayment()||!isCurrent())return;
    byId('placeOrderBtn').click();
  });
  window.BiteMinOrderQuickAdd={open,hide,render,amountRemaining,recommend};
})();