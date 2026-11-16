/* Keep existing Owner form actions reachable when a phone keyboard resizes it. */
(function(root){
 'use strict';
 function geometry({width,height,baseline,visualHeight,offsetTop=0,scale=1,editing=false,owner=false}){
  const open=owner&&editing&&width<=760&&scale===1&&Math.max(baseline,height)-visualHeight>120;
  return{open,bottom:open?Math.max(0,height-visualHeight-offsetTop):0};
 }
 function install(){
  const doc=root.document;if(!doc)return;
  let baseline=root.innerHeight,frame=0;
  const editable=el=>!!el?.closest?.('.bh-form')&&(el.tagName==='TEXTAREA'||el.tagName==='INPUT'&&['text','search','email','tel','number','password','url'].includes(el.type));
  function update(){
   frame=0;const el=doc.activeElement,editing=editable(el),vv=root.visualViewport;
   if(!editing)baseline=root.innerHeight;
   const state=geometry({width:root.innerWidth,height:root.innerHeight,baseline,visualHeight:vv?.height??root.innerHeight,
    offsetTop:vv?.offsetTop||0,scale:vv?.scale||1,editing,owner:doc.body?.dataset.role==='owner'});
   if(!doc.body)return;
   if(!state.open){delete doc.body.dataset.bhKeyboard;doc.body.style.removeProperty('--bh-keyboard-bottom');return}
   doc.body.dataset.bhKeyboard='true';doc.body.style.setProperty('--bh-keyboard-bottom',state.bottom+'px');
   const actions=el.closest('.bh-form')?.querySelector(':scope>.bh-form-actions');
   const top=(vv?.offsetTop||0)+12,bottom=(vv?.offsetTop||0)+(vv?.height??root.innerHeight)-(actions?.getBoundingClientRect().height||0)-28;
   const rect=el.getBoundingClientRect(),delta=rect.bottom>bottom?rect.bottom-bottom:rect.top<top?rect.top-top:0;
   if(Math.abs(delta)>2){
    let scroller=el.parentElement;
    while(scroller&&scroller!==doc.body){
     if(/auto|scroll/.test(root.getComputedStyle(scroller).overflowY)&&scroller.scrollHeight>scroller.clientHeight+1)break;
     scroller=scroller.parentElement;
    }
    (scroller&&scroller!==doc.body?scroller:root).scrollBy({top:delta,behavior:'instant'});
   }
  }
  const schedule=()=>{if(!frame)frame=root.requestAnimationFrame(update)};
  doc.addEventListener('focusin',schedule);doc.addEventListener('focusout',schedule);
  root.addEventListener('resize',schedule);root.visualViewport?.addEventListener('resize',schedule);root.visualViewport?.addEventListener('scroll',schedule);
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState!=='visible'){delete doc.body.dataset.bhKeyboard;doc.body.style.removeProperty('--bh-keyboard-bottom')}else schedule()});
 }
 root.BiteMobileForms={geometry};if(typeof module==='object'&&module.exports)module.exports={geometry};
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',install,{once:true});else install()}
})(typeof window!=='undefined'?window:globalThis);
