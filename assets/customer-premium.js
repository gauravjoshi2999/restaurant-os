/* Bite premium UI progressive enhancement.
   Search, PIN, auth and checkout remain backed by existing application flows. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const locationButton=byId('biteLocationOpen');
  const locationSheet=byId('biteLocationSheet');
  const closeButton=byId('biteSheetClose');
  const savedList=byId('biteSavedAddressList');
  const pinForm=byId('biteSheetPinForm');
  const pinInput=byId('biteSheetPin');
  const status=byId('biteSheetStatus');
  const geoButton=byId('biteSheetGeo');
  const search=byId('homeSearchInput');
  const suggestions=byId('biteSearchSuggestions');
  if(!locationButton||!locationSheet||!closeButton||!savedList||!pinForm||!pinInput||!search||!suggestions)return;
  let focusBeforeSheet=null;
  let requestNumber=0;

  function updateLocationLabel(pin){
    const target=byId('biteLocationTitle');
    if(target)target.textContent=/^\d{6}$/.test(String(pin||''))?'PIN '+pin:'Choose PIN';
  }
  function closeLocation(){
    if(locationSheet.hidden)return;
    locationSheet.hidden=true;
    document.body.classList.remove('bite-location-locked');
    focusBeforeSheet?.focus?.({preventScroll:true});
  }
  function applyPin(pin,addressId){
    if(!/^\d{6}$/.test(pin)){status.textContent='Sahi 6-digit PIN code dalein.';pinInput.focus();return;}
    status.textContent='';
    byId('discoveryPinInput').value=pin;
    window.discoveryAddressId=addressId||null;
    byId('discoveryLocationForm').requestSubmit();
    updateLocationLabel(pin);
    closeLocation();
  }
  function renderAddress(row){
    const button=document.createElement('button');
    button.type='button';
    const label=document.createElement('strong');
    label.textContent=(row.label||'Saved address')+(row.is_default?' · Default':'');
    const desc=document.createElement('span');
    desc.textContent=[row.address_line,row.city,row.postal_code].filter(Boolean).join(' · ');
    button.append(label,desc);
    button.addEventListener('click',()=>applyPin(row.postal_code,row.id));
    savedList.append(button);
  }
  async function loadSavedAddresses(){
    const serial=++requestNumber;
    savedList.replaceChildren();
    const message=document.createElement('p');
    message.textContent='Saved addresses load ho rahe hain…';
    savedList.append(message);
    try{
      const session=await sb.auth.getSession();
      if(serial!==requestNumber||locationSheet.hidden)return;
      if(!session.data?.session){
        message.textContent='Saved addresses ke liye login karein. PIN manually bhi daal sakte hain.';
        const login=document.createElement('button');
        login.type='button';login.textContent='Login to view saved addresses';
        login.addEventListener('click',()=>{closeLocation();showAuth('login');});
        savedList.append(login);
        return;
      }
      const result=await sb.from('customer_addresses')
        .select('id,label,address_line,city,postal_code,is_default')
        .order('is_default',{ascending:false}).limit(25);
      if(result.error)throw result.error;
      if(serial!==requestNumber||locationSheet.hidden)return;
      savedList.replaceChildren();
      const usable=(result.data||[]).filter(row=>/^\d{6}$/.test(row.postal_code||''));
      if(!usable.length){
        const noAddress=document.createElement('p');
        noAddress.textContent='Koi saved address nahi mila. PIN select karein ya Account mein address add karein.';
        savedList.append(noAddress);return;
      }
      usable.forEach(renderAddress);
    }catch(error){
      if(serial!==requestNumber||locationSheet.hidden)return;
      message.textContent='Saved addresses load nahi ho paaye. PIN manually daal sakte hain.';
    }
  }
  function openLocation(){
    focusBeforeSheet=document.activeElement;
    pinInput.value=byId('discoveryPinInput')?.value||'';
    updateLocationLabel(typeof currentDiscoveryPin==='string'?currentDiscoveryPin:'');
    status.style.color='#b42332';status.textContent='';
    locationSheet.hidden=false;
    document.body.classList.add('bite-location-locked');
    closeButton.focus({preventScroll:true});
    loadSavedAddresses();
  }
  locationButton.addEventListener('click',openLocation);
  closeButton.addEventListener('click',closeLocation);
  locationSheet.addEventListener('click',event=>{if(event.target===locationSheet)closeLocation();});
  locationSheet.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeLocation();return;}
    if(event.key!=='Tab')return;
    const focusables=Array.from(locationSheet.querySelectorAll('button:not([disabled]),input:not([disabled])'))
      .filter(el=>el.getClientRects().length);
    if(!focusables.length)return;
    const first=focusables[0],last=focusables[focusables.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  pinForm.addEventListener('submit',event=>{event.preventDefault();applyPin(pinInput.value.trim());});
  if(geoButton)geoButton.addEventListener('click',()=>{
    byId('customerUseLocation')?.click();
    status.style.color='#476956';
    status.textContent='Location se nearby distance dikhega. Delivery availability ke liye PIN select karein.';
  });
  updateLocationLabel(typeof currentDiscoveryPin==='string'?currentDiscoveryPin:'');

  /* Read the same public restaurant/menu collections already used by discovery. */
  function hideSuggestions(){suggestions.hidden=true;search.setAttribute('aria-expanded','false');}
  function showSuggestions(){
    const query=search.value.trim();
    if(query.length<2||byId('homeView')?.classList.contains('hidden')){
      hideSuggestions();return;
    }
    if(typeof BiteDiscovery==='undefined'||typeof restaurants==='undefined'||typeof publicMenuSearch==='undefined'){
      hideSuggestions();return;
    }
    const matches=BiteDiscovery.selectRestaurants(restaurants,publicMenuSearch,{
      query,pin:typeof currentDiscoveryPin==='string'?currentDiscoveryPin:'',
      service:window.restaurantServiceFilter||'all',category:'all',
      diet:byId('discoveryDiet')?.value||'all'
    });
    const eligible=new Set(matches.map(x=>x.restaurant.id));
    const nameQuery=query.toLocaleLowerCase('en-IN');
    const dishMatches=publicMenuSearch.filter(item=>eligible.has(item.restaurant_id)&&
      String(item.name||'').toLocaleLowerCase('en-IN').includes(nameQuery)).slice(0,5);
    suggestions.replaceChildren();
    function group(title,rows,kind){
      if(!rows.length)return;
      const heading=document.createElement('h3');
      heading.textContent=title;suggestions.append(heading);
      rows.forEach(row=>{
        const label=kind==='Restaurant'?row.restaurant.name:row.name;
        const button=document.createElement('button');button.type='button';
        const kindTag=document.createElement('span');kindTag.className='bite-search-kind';kindTag.textContent=kind;
        const text=document.createElement('span');text.textContent=label;
        button.append(kindTag,text);
        button.addEventListener('click',()=>{
          search.value=label;
          search.dispatchEvent(new Event('input',{bubbles:true}));
          hideSuggestions();
          byId('restaurantResults')?.scrollIntoView({
            behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
            block:'start'
          });
        });
        suggestions.append(button);
      });
    }
    group('Restaurants',matches.slice(0,5),'Restaurant');
    group('Dishes',dishMatches,'Dish');
    if(!suggestions.children.length){
      const empty=document.createElement('p');
      empty.className='bite-sheet-hint';empty.textContent='Is search mein koi matching restaurant ya dish nahi mili.';
      suggestions.append(empty);
    }
    suggestions.hidden=false;
    search.setAttribute('aria-expanded','true');
  }
  search.setAttribute('aria-controls','biteSearchSuggestions');
  search.setAttribute('aria-expanded','false');
  search.setAttribute('autocomplete','off');
  search.addEventListener('input',showSuggestions);
  search.addEventListener('focus',showSuggestions);
  search.addEventListener('keydown',event=>{
    if(event.key==='Escape'){hideSuggestions();return;}
    if(event.key==='ArrowDown'&&!suggestions.hidden){
      const first=suggestions.querySelector('button');
      if(first){event.preventDefault();first.focus();}
    }
    if(event.key==='Enter')hideSuggestions();
  });
  suggestions.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();hideSuggestions();search.focus();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      const buttons=Array.from(suggestions.querySelectorAll('button'));
      const index=buttons.indexOf(document.activeElement);
      if(index>=0){
        event.preventDefault();
        (buttons[index+(event.key==='ArrowDown'?1:-1)]||search).focus();
      }
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.bite-search-container'))hideSuggestions();
  });
  byId('discoveryLocationForm')?.addEventListener('submit',()=>{
    updateLocationLabel(byId('discoveryPinInput')?.value.trim());
  });
})();