/* Bite premium Owner shell. UI/navigation only; data and permissions stay in existing controllers. */
(function(root){
  'use strict';
  const actionCatalog={
    'hotel-register':{label:'Guest Register',hint:'Check-in and guest details',icon:'register'},
    reservations:{label:'Reservations',hint:'Upcoming stays',icon:'calendar'},
    rooms:{label:'Rooms',hint:'Status and availability',icon:'bed'},
    guests:{label:'Guests',hint:'Guest directory',icon:'people'},
    folios:{label:'Folios & Bills',hint:'Room charges and receipts',icon:'receipt'},
    housekeeping:{label:'Housekeeping',hint:'Room readiness',icon:'sparkles'},
    orders:{label:'Live Orders',hint:'Accept and track orders',icon:'orders'},
    pos:{label:'POS & Billing',hint:'Counter and dine-in sales',icon:'pos'},
    menu:{label:'Menu',hint:'Dishes and pricing',icon:'menu'},
    tables:{label:'Tables',hint:'Dine-in',icon:'table'},
    inventory:{label:'Inventory',hint:'Stock overview',icon:'package'},
    expenses:{label:'Expenses',hint:'Daily outgoings',icon:'wallet'},
    hr:{label:'Team',hint:'Staff and attendance',icon:'people'},
    reports:{label:'Reports',hint:'Business insights',icon:'chart'},
    cashbook:{label:'Cashbook',hint:'Daily closing',icon:'wallet'}
  };
  const paths={
    bed:'<rect x="3" y="10" width="18" height="8" rx="2"/><path d="M3 18v3m18-3v3M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M7 8h3m4 0h3"/>',
    register:'<path d="M8 3h8l2 3v15H6V6zM9 3v4h6V3M9 12h6M9 16h4"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h3"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5"/>',
    receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
    sparkles:'<path d="m12 2 2.3 6.7L21 11l-6.7 2.3L12 20l-2.3-6.7L3 11l6.7-2.3zM19 19l1 1m-16-1-1 1"/>',
    orders:'<path d="M6 7h12l2 14H4zM9 8V6a3 3 0 0 1 6 0v2"/>',
    pos:'<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M7 7h10M7 11h6M8 21h8m-4-3v3"/>',
    menu:'<path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"/>',
    table:'<path d="M3 9h18v4H3zM6 13v8m12-8v8M9 5h6"/>',
    package:'<path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
    wallet:'<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 9V5a2 2 0 0 1 2-2h12M16 13h5v4h-5a2 2 0 0 1 0-4z"/>',
    chart:'<path d="M4 21V3m0 18h17M8 17v-6m5 6V7m5 10V4"/>'
  };
  const presets={
    hotel:['hotel-register','rooms','reservations','folios','housekeeping','guests','reports','expenses'],
    restaurant:['orders','pos','menu','tables','inventory','expenses','hr','reports'],
    hybrid:['hotel-register','orders','rooms','pos','reservations','folios','menu','housekeeping','reports','hr','inventory','expenses']
  };
  const copy={
    hotel:{eyebrow:'HOTEL MANAGEMENT',title:'A thoughtful way to run your hotel.',subtitle:'Front desk, rooms and guest experience — beautifully organised.',button:'Open guest register',route:'hotel-register'},
    restaurant:{eyebrow:'RESTAURANT MANAGEMENT',title:'Your restaurant, beautifully in control.',subtitle:'Orders, billing and daily operations in one clear workspace.',button:'Open live orders',route:'orders'},
    hybrid:{eyebrow:'HOTEL + RESTAURANT',title:'Two businesses. One seamless workspace.',subtitle:'Move confidently between hospitality and dining operations.',button:'Open front desk',route:'hotel-register'}
  };
  const svg=key=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(paths[key]||paths.chart)+'</svg>';
  function actionsFor(type,allowed){
    const allow=new Set(Array.isArray(allowed)?allowed:[]);
    return (presets[type]||presets.restaurant).filter(id=>allow.has(id)).map(id=>({page:id,...actionCatalog[id]}));
  }
  function render(){
    const doc=root.document;
    if(!doc)return;
    const home=doc.getElementById('overview');
    const property=root.BiteHospitality&&root.BiteHospitality.prop&&root.BiteHospitality.prop();
    let node=doc.getElementById('bitePremiumHome');
    if(doc.body.dataset.role!=='owner'||!property||!home){
      if(node)node.remove();
      doc.body.classList.remove('bite-premium-ready');
      return;
    }
    const type=['hotel','restaurant','hybrid'].includes(property.business_type)?property.business_type:'restaurant';
    const routes=root.BiteHospitality.routeList({role:'owner',property})||[];
    const actions=actionsFor(type,routes);
    if(!actions.length){if(node)node.remove();doc.body.classList.remove('bite-premium-ready');return;}
    const marker=String(property.id)+'|'+type+'|'+routes.join(',');
    if(node&&node.dataset.signature===marker)return;
    if(!node){node=doc.createElement('section');node.id='bitePremiumHome';node.className='bite-premium-home';node.setAttribute('aria-label','Business overview');home.prepend(node);}
    node.replaceChildren();
    node.dataset.signature=marker;node.dataset.mode=type;
    const hero=doc.createElement('div');hero.className='bite-premium-hero';
    const brand=doc.createElement('div');brand.className='bite-premium-hero-copy';
    const eyebrow=doc.createElement('span');eyebrow.className='bite-premium-eyebrow';eyebrow.textContent=copy[type].eyebrow;
    const headline=doc.createElement('h1');headline.textContent=copy[type].title;
    const subtitle=doc.createElement('p');subtitle.textContent=copy[type].subtitle;
    const propertyChip=doc.createElement('span');propertyChip.className='bite-premium-property';propertyChip.textContent=property.name||'Your property';
    brand.append(eyebrow,headline,subtitle,propertyChip);
    const motif=doc.createElement('div');motif.className='bite-premium-motif';motif.setAttribute('aria-hidden','true');
    motif.innerHTML='<span class="bite-premium-motif-orbit"></span><span class="bite-premium-motif-icon">'+svg(type==='restaurant'?'menu':type==='hotel'?'bed':'sparkles')+'</span>';
    hero.append(brand,motif);
    const header=doc.createElement('div');header.className='bite-premium-actions-heading';
    const label=doc.createElement('div');label.innerHTML='<span>QUICK ACCESS</span><h2>Your everyday tools</h2>';
    const count=doc.createElement('small');count.textContent=type==='hybrid'?'Hotel & restaurant operations':'Essential workspaces';
    header.append(label,count);
    const grid=doc.createElement('div');grid.className='bite-premium-actions';
    for(const action of actions){
      const button=doc.createElement('button');button.type='button';button.className='bite-premium-action';button.dataset.page=action.page;
      button.setAttribute('aria-label','Open '+action.label);
      const emblem=doc.createElement('span');emblem.className='bite-premium-action-icon';emblem.innerHTML=svg(action.icon);
      const name=doc.createElement('strong');name.textContent=action.label;
      const detail=doc.createElement('small');detail.textContent=action.hint;
      const arrow=doc.createElement('span');arrow.className='bite-premium-chevron';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
      button.append(emblem,name,detail,arrow);grid.append(button);
    }
    node.append(hero,header,grid);
    doc.body.classList.add('bite-premium-ready');
  }
  function navigate(event){
    const button=event.target.closest('button[data-page]');
    if(!button||!event.currentTarget.contains(button))return;
    const property=root.BiteHospitality?.prop?.();
    const current=root.BiteHospitality?.routeList?.({role:'owner',property})||[];
    if(!current.includes(button.dataset.page))return;
    if(typeof root.showPage==='function')void Promise.resolve(root.showPage(button.dataset.page)).catch(error=>root.console?.warn?.('Owner page could not be opened',error));
  }
  function start(){
    if(!root.document)return;
    root.document.getElementById('overview')?.addEventListener('click',function(e){if(e.target.closest('#bitePremiumHome'))navigate(Object.assign(e,{currentTarget:e.target.closest('#bitePremiumHome')}));});
    render();
    if(typeof root.MutationObserver==='function'){
      const observer=new root.MutationObserver(render);
      observer.observe(root.document.body,{attributes:true,attributeFilter:['data-role','data-business-type','data-universal-owner','data-restaurant-access']});
    }
    root.addEventListener('bite:capabilities',render);
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={actionsFor,presets,copy};
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:globalThis);
