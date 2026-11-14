/* Bite premium menu + cart enhancements. Reuses existing restaurant-scoped
   menuItems/cart/renderCart. Never creates orders or calculates payment totals. */
(function(){
  'use strict';
  const list=document.getElementById('biteCartAddOnList');
  const wrapper=document.getElementById('biteCartAddOns');
  const status=document.getElementById('biteCartAddOnStatus');
  if(!list||!wrapper||!status)return;

  function renderAddOns(){
    const currentItems=typeof menuItems!=='undefined'?menuItems:[];
    const currentCart=typeof cart!=='undefined'?cart:{};
    const hasItems=typeof cartEntries==='function'&&cartEntries().length>0;
    // Suggestions are simply other available menu items, not claimed to be
    // favourites, personalised recommendations or any popularity ranking.
    const choices=hasItems?currentItems.filter(item=>
      item&&item.id&&!currentCart[item.id]&&Number.isFinite(Number(item.price))
      &&Number(item.price)>=0
    ).slice(0,6):[];
    list.replaceChildren();
    wrapper.hidden=!choices.length;
    for(const item of choices){
      const article=document.createElement('article');
      article.className='bite-cart-add-on';
      const image=document.createElement('img');
      image.src=BiteDiscovery.safeImage(item.image_url,'assets/food-placeholder.svg');
      image.alt='';
      image.loading='lazy';
      image.decoding='async';
      image.addEventListener('error',()=>{
        if(image.getAttribute('src')!=='assets/food-placeholder.svg')image.src='assets/food-placeholder.svg';
      },{once:true});
      const name=document.createElement('strong');
      name.textContent=item.name||'Dish';
      name.title=item.name||'Dish';
      const price=document.createElement('span');
      price.className='bite-cart-add-on-price';
      price.textContent=money(item.price);
      const add=document.createElement('button');
      add.type='button';
      add.dataset.biteAddOn=item.id;
      add.textContent='+ Add';
      add.setAttribute('aria-label','Add '+item.name+' to cart for '+money(item.price));
      add.disabled=typeof pendingLiveCheckout!=='undefined'&&!!pendingLiveCheckout;
      article.append(image,name,price,add);
      list.append(article);
    }
  }

  list.addEventListener('click',event=>{
    const button=event.target.closest('button[data-bite-add-on]');
    if(!button||button.disabled)return;
    const id=button.dataset.biteAddOn;
    const item=menuItems.find(candidate=>candidate.id===id);
    if(!item||Number(cart[id]||0)>=99)return;
    if(typeof pendingLiveCheckout!=='undefined'&&pendingLiveCheckout){
      status.textContent='Pehle pending payment ka status check karein.';
      return;
    }
    // Same mutation/update functions used by ADD on the ordinary menu.
    hideCartUndo();
    cart[id]=Math.min(99,Number(cart[id]||0)+1);
    renderCart();
    refreshMenuQuantityControl(id);
    status.textContent=item.name+' added to cart.';
    document.getElementById('addMoreItems')?.focus({preventScroll:true});
  });

  window.BiteMenuCartPremium={renderAddOns};
})();