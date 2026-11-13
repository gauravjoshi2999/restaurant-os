/* Owner mobile HR task tabs. Presentation only — preserves every live form and handler. */
(function(root){
  'use strict';
  const panels=Object.freeze(['employee','attendance','leave','payment']);
  function activate(doc,name){
    if(!doc||!panels.includes(name))return false;
    const page=doc.getElementById('hr');
    if(!page)return false;
    let found=false;
    for(const tab of page.querySelectorAll('.bite-hr-tab[data-hr-tab]')){
      const current=tab.dataset.hrTab===name;
      tab.setAttribute('aria-selected',String(current));
      tab.tabIndex=current?0:-1;
      if(current)found=true;
    }
    if(!found)return false;
    for(const panel of page.querySelectorAll('.bite-hr-editor-grid [data-hr-panel]')){
      if(panel.dataset.hrPanel===name)panel.dataset.hrSelected='true';
      else delete panel.dataset.hrSelected;
    }
    return true;
  }
  function init(doc){
    const list=doc?.querySelector('#hr .bite-hr-tabs');
    if(!list||list.dataset.biteInitialized==='true')return;
    list.dataset.biteInitialized='true';
    list.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-hr-tab]');
      if(button&&list.contains(button)&&doc.body.dataset.role==='owner'){
        activate(doc,button.dataset.hrTab);
      }
    });
    list.addEventListener('keydown',event=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
      const active=event.target.closest?.('[data-hr-tab]');
      if(!active||!list.contains(active)||doc.body.dataset.role!=='owner')return;
      const index=panels.indexOf(active.dataset.hrTab);
      if(index<0)return;
      const next=event.key==='Home'?0:event.key==='End'?panels.length-1:
        (index+(event.key==='ArrowRight'?1:-1)+panels.length)%panels.length;
      const button=list.querySelector('[data-hr-tab="'+panels[next]+'"]');
      if(button){event.preventDefault();activate(doc,panels[next]);button.focus();}
    });
    activate(doc,'employee');
  }
  const api={panels,activate,init};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    root.BiteOwnerHRTabs=api;
    if(typeof document!=='undefined'){
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(document),{once:true});
      else init(document);
    }
  }
})(typeof window!=='undefined'?window:globalThis);
