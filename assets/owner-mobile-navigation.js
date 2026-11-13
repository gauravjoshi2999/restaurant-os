/* Bite Owner mobile navigation. Presentation only; existing showPage and access guards remain authoritative. */
(function(root){
  'use strict';
  const tabs=[
    {page:'overview',label:'Home',icon:'home'},
    {page:'orders',label:'Orders',icon:'orders'},
    {page:'pos',label:'POS',icon:'pos'},
    {page:'menu',label:'Menu',icon:'menu'},
    {page:'more',label:'More',icon:'more'}
  ];
  const icons={
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    orders:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    pos:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h5M15 13h2M15 17h2"/>',
    menu:'<path d="M5 5h14M5 10h14M5 15h9M5 20h9"/>',
    more:'<circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="19" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/>'
  };
  const sections=Object.freeze([
    {heading:'Roz ka hisaab',items:[['expenses','Kharcha','Daily expenses','₹'],['cashbook','Cashbook','Cash, UPI & day closing','▤'],['khata','Customer Khata','Udhaar aur vasooli','↔'],['purchases','Suppliers','Kharid aur payments','▣']]},
    {heading:'Restaurant operations',items:[['tables','Tables','Dine-in tables','▦'],['inventory','Stock','Inventory manage karein','▥'],['hr','Staff','Attendance & salary','♙']]},
    {heading:'Reports & settings',items:[['reports','Reports','Sales & business reports','▥'],['settings','Settings','Restaurant & delivery areas','⚙']]}
  ]);
  function navigationState(role,page,moreOpen=false){
    const visible=role==='owner';
    return {visible,showBack:visible&&(moreOpen||page!=='overview'),
      active:visible?(moreOpen?'more':tabs.some(t=>t.page===page&&t.page!=='more')?page:'more'):null};
  }
  function init(doc){
    if(!doc||doc.getElementById('biteOwnerBottomNav'))return;
    const app=doc.getElementById('mainApp');
    const header=app?.querySelector('.main > .top');
    const side=app?.querySelector('.side');
    const menuButton=header?.querySelector('.sidebar-toggle');
    const pageTitle=doc.getElementById('pageTitle');
    const content=app?.querySelector('.main > .content');
    if(!app||!header||!side||!menuButton||!pageTitle||!content)return;
    const mobile=()=>!!root.matchMedia?.('(max-width:760px)').matches;
    const currentPage=()=>app.querySelector('.page.active:not([hidden])')?.id||'overview';
    const currentSection=()=>app.querySelector('.page.active:not([hidden])');
    let moreOpen=false,previousTitle='Overview';

    const back=doc.createElement('button');
    back.type='button';back.className='bite-owner-back';
    back.setAttribute('aria-label','Pichhle section par wapas');
    back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7M7 12h14"/></svg>';
    header.insertBefore(back,menuButton);

    // Real More workspace: the same owner-only routes, without opening the sidebar.
    const moreScreen=doc.createElement('section');
    moreScreen.id='biteOwnerMoreScreen';moreScreen.className='bite-owner-more-screen';
    moreScreen.hidden=true;moreScreen.setAttribute('aria-label','More restaurant owner sections');
    const moreHead=doc.createElement('header');
    moreHead.className='bite-more-head';
    const moreTitle=doc.createElement('h1');moreTitle.textContent='Saare sections';
    const moreIntro=doc.createElement('p');moreIntro.textContent='Restaurant ka har zaroori kaam ek jagah.';
    moreHead.append(moreTitle,moreIntro);moreScreen.append(moreHead);
    for(const section of sections){
      const group=doc.createElement('section');group.className='bite-more-group';
      const h=doc.createElement('h2');h.textContent=section.heading;group.append(h);
      const grid=doc.createElement('div');grid.className='bite-more-grid';
      for(const [page,label,description,icon] of section.items){
        const button=doc.createElement('button');button.type='button';
        button.className='bite-more-item';button.dataset.ownerRoute=page;
        const glyph=doc.createElement('span');glyph.className='bite-more-item-icon';
        glyph.setAttribute('aria-hidden','true');glyph.textContent=icon;
        const copy=doc.createElement('span');copy.className='bite-more-item-copy';
        const strong=doc.createElement('strong');strong.textContent=label;
        const small=doc.createElement('small');small.textContent=description;
        copy.append(strong,small);
        const arrow=doc.createElement('span');arrow.className='bite-more-item-arrow';
        arrow.setAttribute('aria-hidden','true');arrow.textContent='›';
        button.append(glyph,copy,arrow);
        button.addEventListener('click',()=>{
          if(doc.body.dataset.role!=='owner'||!mobile())return;
          closeMore();
          if(typeof root.showPage==='function')void root.showPage(page);
        });
        grid.append(button);
      }
      group.append(grid);moreScreen.append(group);
    }
    const prefs=doc.createElement('section');prefs.className='bite-more-group';
    const prefsTitle=doc.createElement('h2');prefsTitle.textContent='App';
    const languageSlot=doc.createElement('div');languageSlot.className='bite-more-languages';
    prefs.append(prefsTitle,languageSlot);
    const logoutButton=doc.createElement('button');logoutButton.type='button';
    logoutButton.className='bite-more-logout';logoutButton.textContent='Logout';
    logoutButton.addEventListener('click',()=>{
      if(doc.body.dataset.role==='owner'&&typeof root.logout==='function')void root.logout();
    });
    prefs.append(logoutButton);moreScreen.append(prefs);content.append(moreScreen);
    const languageRow=doc.querySelector('.bite-language-row');
    const languageControls=languageRow?.querySelector('.bite-language-controls');
    const stageSource=doc.querySelector('#overview .od-live .od-stages');
    const priority=doc.querySelector('#overview .od-owner-priority');
    const priorityList=doc.getElementById('ownerPriorityOrders');
    const stageMarker=stageSource?doc.createComment('Owner stage buttons original location'):null;
    if(stageSource&&stageMarker)stageSource.before(stageMarker);
    const priorityHeading=priority?.querySelector('.od-priority-title');
    if(priorityHeading&&!priorityHeading.querySelector('.bite-owner-view-orders')){
      const seeAll=doc.createElement('button');seeAll.type='button';
      seeAll.className='bite-owner-view-orders';seeAll.textContent='Sab orders ›';
      seeAll.addEventListener('click',()=>{if(typeof root.showPage==='function')void root.showPage('orders')});
      priorityHeading.append(seeAll);
    }
    function syncResponsive(){
      const ownerMobile=doc.body.dataset.role==='owner'&&mobile();
      if(languageControls&&languageRow){
        if(ownerMobile&&languageControls.parentNode!==languageSlot)languageSlot.append(languageControls);
        else if(!ownerMobile&&languageControls.parentNode!==languageRow)languageRow.append(languageControls);
      }
      if(stageSource&&stageMarker&&priorityList){
        if(ownerMobile&&stageSource.parentNode!==priority)priority.insertBefore(stageSource,priorityList);
        else if(!ownerMobile&&stageMarker.parentNode&&stageSource.parentNode!==stageMarker.parentNode)stageMarker.after(stageSource);
      }
      if(!ownerMobile&&moreOpen)closeMore();
    }
    function openMore(){
      if(doc.body.dataset.role!=='owner'||!mobile())return;
      if(typeof root.toggleSidebar==='function')root.toggleSidebar(false);
      if(moreOpen)return;
      previousTitle=pageTitle.textContent;
      moreOpen=true;moreScreen.hidden=false;app.dataset.biteMoreOpen='true';
      currentSection()?.setAttribute('aria-hidden','true');
      pageTitle.textContent='More';
      sync();
      if(typeof root.scrollTo==='function')root.scrollTo({top:0,behavior:'instant'});
    }
    function closeMore(){
      if(!moreOpen)return;
      moreOpen=false;moreScreen.hidden=true;delete app.dataset.biteMoreOpen;
      currentSection()?.setAttribute('aria-hidden','false');
      pageTitle.textContent=previousTitle;
      sync();
    }
    const nav=doc.createElement('nav');
    nav.id='biteOwnerBottomNav';nav.className='bite-owner-bottom-nav';
    nav.setAttribute('aria-label','Restaurant owner quick navigation');
    tabs.forEach(tab=>{
      const button=doc.createElement('button');
      button.type='button';button.dataset.bitePage=tab.page;
      button.className='bite-owner-tab';
      button.setAttribute('aria-label',tab.page==='pos'?'POS billing workspace kholein':tab.page==='menu'?'Menu aur prices manage karein':tab.page==='more'?'Baaki owner sections kholein':tab.label);
      const graphic=doc.createElement('span');graphic.className='bite-owner-tab-icon';
      graphic.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+icons[tab.icon]+'</svg>';
      const label=doc.createElement('span');label.className='bite-owner-tab-label';label.textContent=tab.label;
      button.append(graphic,label);nav.append(button);
      button.addEventListener('click',()=>{
        if(doc.body.dataset.role!=='owner')return;
        if(tab.page==='more'){openMore();return}
        closeMore();
        // POS is a canonical workspace. Opening a new bill remains the explicit
        // action inside POS; existing Home one-tap billing remains available.
        if(typeof root.showPage==='function')void root.showPage(tab.page);
      });
    });
    app.append(nav);

    const drawerLogout=doc.createElement('button');
    drawerLogout.type='button';drawerLogout.className='bite-owner-drawer-logout';
    drawerLogout.textContent='Logout';
    drawerLogout.addEventListener('click',()=>{if(doc.body.dataset.role==='owner'&&typeof root.logout==='function')void root.logout()});
    side.append(drawerLogout);

    const history=[];
    let lastPage=currentPage();
    let pendingBack=false;
    function sync(){
      const page=currentPage();
      if(doc.body.dataset.role!=='owner'&&moreOpen)closeMore();
      const state=navigationState(doc.body.dataset.role,page,moreOpen);
      nav.hidden=!state.visible;
      drawerLogout.hidden=!state.visible;
      back.hidden=!state.showBack;
      if(moreOpen&&pageTitle.textContent!=='More'){closeMore();return;}
      if(state.visible&&page!==lastPage){
        if(page==='overview')history.length=0;
        else if(!pendingBack)history.push(lastPage);
        lastPage=page;pendingBack=false;
      }
      nav.querySelectorAll('button[data-bite-page]').forEach(button=>{
        const active=button.dataset.bitePage===state.active;
        button.classList.toggle('active',active);
        if(active&&button.dataset.bitePage!=='more')button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
      const more=nav.querySelector('[data-bite-page="more"]');
      if(more)more.setAttribute('aria-expanded',String(moreOpen));
    }
    back.addEventListener('click',()=>{
      if(doc.body.dataset.role!=='owner')return;
      if(moreOpen){closeMore();return}
      const target=history.pop()||'overview';
      pendingBack=true;
      if(typeof root.showPage==='function')void root.showPage(target);
    });
    // showPage updates the title after activating a section; this also catches
    // navigation from existing dashboard shortcuts and the full drawer.
    const titleObserver=new MutationObserver(sync);
    titleObserver.observe(pageTitle,{childList:true,characterData:true,subtree:true});
    const roleObserver=new MutationObserver(()=>{syncResponsive();sync()});
    roleObserver.observe(doc.body,{attributes:true,attributeFilter:['data-role']});
    const drawerObserver=new MutationObserver(sync);
    drawerObserver.observe(side,{attributes:true,attributeFilter:['class']});
    root.addEventListener?.('resize',syncResponsive);
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&moreOpen){event.preventDefault();closeMore()}});
    syncResponsive();sync();
  }
  const api={tabs,sections,navigationState,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else {
    root.BiteOwnerMobileNavigation=api;
    if(typeof document!=='undefined'){
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(document),{once:true});
      else init(document);
    }
  }
})(typeof window!=='undefined'?window:globalThis);
