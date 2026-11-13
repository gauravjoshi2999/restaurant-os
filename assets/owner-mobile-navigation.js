/* Bite Owner mobile navigation. Presentation only; existing showPage and access guards remain authoritative. */
(function(root){
  'use strict';
  const tabs=[
    {page:'overview',label:'Home',icon:'home'},
    {page:'orders',label:'Orders',icon:'orders'},
    {page:'pos',label:'New Bill',icon:'bill'},
    {page:'expenses',label:'Kharcha',icon:'expenses'},
    {page:'more',label:'More',icon:'more'}
  ];
  const icons={
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    orders:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    bill:'<path d="M12 5v14M5 12h14"/>',
    expenses:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    more:'<circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="19" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/>'
  };
  function navigationState(role,page){
    const visible=role==='owner';
    return {visible,showBack:visible&&page!=='overview',
      active:visible?(tabs.some(t=>t.page===page&&t.page!=='more')?page:'more'):null};
  }
  function init(doc){
    if(!doc||doc.getElementById('biteOwnerBottomNav'))return;
    const app=doc.getElementById('mainApp');
    const header=app?.querySelector('.main > .top');
    const side=app?.querySelector('.side');
    const menuButton=header?.querySelector('.sidebar-toggle');
    const pageTitle=doc.getElementById('pageTitle');
    if(!app||!header||!side||!menuButton||!pageTitle)return;

    const back=doc.createElement('button');
    back.type='button';back.className='bite-owner-back';
    back.setAttribute('aria-label','Pichhle section par wapas');
    back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7M7 12h14"/></svg>';
    header.insertBefore(back,menuButton);

    const nav=doc.createElement('nav');
    nav.id='biteOwnerBottomNav';nav.className='bite-owner-bottom-nav';
    nav.setAttribute('aria-label','Restaurant owner quick navigation');
    tabs.forEach(tab=>{
      const button=doc.createElement('button');
      button.type='button';button.dataset.bitePage=tab.page;
      button.className='bite-owner-tab'+(tab.page==='pos'?' bite-owner-tab-bill':'');
      button.setAttribute('aria-label',tab.page==='pos'?'Naya POS bill banayein':tab.page==='more'?'Saare sections kholein':tab.label);
      const graphic=doc.createElement('span');graphic.className='bite-owner-tab-icon';
      graphic.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+icons[tab.icon]+'</svg>';
      const label=doc.createElement('span');label.className='bite-owner-tab-label';label.textContent=tab.label;
      button.append(graphic,label);nav.append(button);
      button.addEventListener('click',()=>{
        if(doc.body.dataset.role!=='owner')return;
        if(tab.page==='more'){if(typeof root.toggleSidebar==='function')root.toggleSidebar(true);return}
        if(tab.page==='pos'){if(typeof root.openPosFromOverview==='function')void root.openPosFromOverview(button);return}
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
    let lastPage=app.querySelector('.page.active:not([hidden])')?.id||'overview';
    let pendingBack=false;
    const currentPage=()=>app.querySelector('.page.active:not([hidden])')?.id||'overview';
    function sync(){
      const page=currentPage();
      const state=navigationState(doc.body.dataset.role,page);
      nav.hidden=!state.visible;
      drawerLogout.hidden=!state.visible;
      back.hidden=!state.showBack;
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
      if(more)more.setAttribute('aria-expanded',String(side.classList.contains('sidebar-open')));
    }
    back.addEventListener('click',()=>{
      if(doc.body.dataset.role!=='owner')return;
      const target=history.pop()||'overview';
      pendingBack=true;
      if(typeof root.showPage==='function')void root.showPage(target);
    });
    // showPage updates the title after activating a section; this also catches
    // navigation from existing dashboard shortcuts and the full drawer.
    const titleObserver=new MutationObserver(sync);
    titleObserver.observe(pageTitle,{childList:true,characterData:true,subtree:true});
    const roleObserver=new MutationObserver(sync);
    roleObserver.observe(doc.body,{attributes:true,attributeFilter:['data-role']});
    const drawerObserver=new MutationObserver(sync);
    drawerObserver.observe(side,{attributes:true,attributeFilter:['class']});
    sync();
  }
  const api={tabs,navigationState,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else {
    root.BiteOwnerMobileNavigation=api;
    if(typeof document!=='undefined'){
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(document),{once:true});
      else init(document);
    }
  }
})(typeof window!=='undefined'?window:globalThis);
