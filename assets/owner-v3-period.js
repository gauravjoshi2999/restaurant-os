/* Bite Owner V3 A02: shared read-only record period control.
 * Changing a report date never changes order clocks, availability or the new-entry date. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const validMonth=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
 const endOfMonth=m=>{
  if(!validMonth(m))throw Error('Choose a valid month.');
  const date=new Date(m+'-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+1,0);
  return date.toISOString().slice(0,10);
 };
 function normalize(value,today){
  if(!validDay(today))throw Error('Business date unavailable.');
  const v=value||{mode:'month',month:today.slice(0,7)};
  const mode=v.mode||'month';
  let from,to;
  if(mode==='day'){from=to=v.day;}
  else if(mode==='month'){from=v.month+'-01';to=endOfMonth(v.month);if(from<=today&&to>today)to=today;}
  else if(mode==='range'){from=v.from;to=v.to;}
  else throw Error('Choose Day, Month or Range.');
  if(!validDay(from)||!validDay(to)||from>to)throw Error('Choose a valid date period.');
  if(to>today)throw Error('Record period cannot be after today.');
  const days=(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000;
  if(days>366)throw Error('Choose a range of up to 367 days.');
  return {mode,from,to,day:mode==='day'?from:'',month:mode==='month'?from.slice(0,7):''};
 }
 function label(v){
  if(!v)return '';
  const fmt=s=>new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(s+'T12:00:00Z'));
  return v.mode==='month'?new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(v.from+'T12:00:00Z')):
   v.mode==='day'?fmt(v.from):fmt(v.from)+' — '+fmt(v.to);
 }
 const mounted=new WeakMap();
 function mount(target,options){
  if(!target||typeof options?.onApply!=='function')return null;
  const today=()=>typeof options.today==='function'?options.today():options.today;
  let selected=normalize(options.value,today()),draft={...selected},editing=false,disposed=false,busy=false;
  mounted.get(target)?.dispose();
  const visible=()=>!disposed&&target.isConnected&&(!options.isCurrent||options.isCurrent());
  const modes={day:'Day',month:'Month',range:'Range'};
  function draw(){
   if(disposed)return;
   const value=selected,mode=draft.mode;
   const editingFields=mode==='day'?'<label>Day<input name="day" type="date" value="'+esc(draft.day||draft.from||today())+'" max="'+esc(today())+'" required></label>':
    mode==='month'?'<label>Month<input name="month" type="month" value="'+esc(draft.month||draft.from.slice(0,7))+'" max="'+esc(today().slice(0,7))+'" required></label>':
    '<label>From<input name="from" type="date" value="'+esc(draft.from||today())+'" max="'+esc(today())+'" required></label>'+
    '<label>To<input name="to" type="date" value="'+esc(draft.to||today())+'" max="'+esc(today())+'" required></label>';
   target.innerHTML='<section class="bv3-period" aria-label="Record period selection">'+
    '<div class="bv3-period-head"><div><small>RECORD PERIOD · '+esc(options.basis||'Record date')+'</small><strong>'+esc(label(value))+'</strong>'+
    '<span>'+esc(value.mode.toUpperCase())+' · '+esc(value.from)+(value.to!==value.from?' → '+esc(value.to):'')+'</span></div>'+
    '<button type="button" data-bv3-period-toggle aria-expanded="'+editing+'">'+(editing?'Close':'Choose period')+'</button></div>'+
    (editing?'<form data-bv3-period-form><div class="bv3-period-tabs" role="group" aria-label="Period mode">'+
     Object.entries(modes).map(([k,v])=>'<button type="button" data-bv3-period-mode="'+k+'" aria-pressed="'+String(mode===k)+'"'+(mode===k?' class="active"':'')+'>'+v+'</button>').join('')+'</div>'+
     '<div class="bv3-period-fields">'+editingFields+'</div><div class="bv3-period-actions">'+
     '<button type="button" data-bv3-period-today>Today</button><button type="button" data-bv3-period-cancel>Cancel</button>'+
     '<button type="submit" class="primary"'+(busy?' disabled':'')+'>Apply</button></div>'+
     '<p class="bv3-period-help">Only report records change. A new bill or entry keeps its own date.</p>'+
     '<p data-bv3-period-error role="alert"></p></form>':'')+'</section>';
  }
  const onClick=event=>{
   if(!visible()||busy)return;
   const button=event.target.closest?.('button');if(!button||!target.contains(button))return;
   const mode=button.dataset.bv3PeriodMode;
   if(mode&&Object.hasOwn(modes,mode)){
    const form=target.querySelector('[data-bv3-period-form]');
    if(form){const fields=new FormData(form);
     if(draft.mode==='day'&&fields.get('day'))draft.day=String(fields.get('day'));
     if(draft.mode==='month'&&fields.get('month'))draft.month=String(fields.get('month'));
     if(draft.mode==='range'){draft.from=String(fields.get('from')||draft.from);draft.to=String(fields.get('to')||draft.to)}
    }
    draft={...draft,mode};
    if(mode==='day'&&!validDay(draft.day))draft.day=draft.from||today();
    if(mode==='month'&&!validMonth(draft.month))draft.month=draft.from?.slice(0,7)||today().slice(0,7);
    if(mode==='range'&&(!validDay(draft.from)||!validDay(draft.to))){draft.from=today();draft.to=today();}
    draw();return;
   }
   if(button.matches('[data-bv3-period-toggle]')){editing=!editing;draft={...selected};draw();return;}
   if(button.matches('[data-bv3-period-cancel]')){draft={...selected};editing=false;draw();return;}
   if(button.matches('[data-bv3-period-today]')){draft={mode:'day',day:today(),from:today(),to:today()};draw();}
  };
  const onSubmit=async event=>{
   if(!event.target.matches('[data-bv3-period-form]')||!visible())return;
   event.preventDefault();event.stopPropagation();if(busy)return;
   const form=event.target,fields=new FormData(form);
   try{
    const raw={mode:draft.mode,day:fields.get('day'),month:fields.get('month'),from:fields.get('from'),to:fields.get('to')};
    const chosen=normalize(raw,today());busy=true;form.querySelector('[type="submit"]').disabled=true;
    await options.onApply(chosen);
    if(!visible())return;
    selected=chosen;draft={...chosen};editing=false;draw();
   }catch(e){
    if(visible()){
     const error=target.querySelector('[data-bv3-period-error]');
     if(error)error.textContent=e.message||'Unable to change period.';
     const submit=target.querySelector('button[type="submit"]');if(submit)submit.disabled=false;
    }
   }finally{busy=false}
  };
  target.addEventListener('click',onClick);
  target.addEventListener('submit',onSubmit);
  const controller={getSelected:()=>({...selected}),dispose(){disposed=true;target.removeEventListener?.('click',onClick);target.removeEventListener?.('submit',onSubmit);if(mounted.get(target)===controller)mounted.set(target,null);}};
  mounted.set(target,controller);
  draw();
  return controller;
 }
 const api={validDay,validMonth,endOfMonth,normalize,label,mount};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3Period=api;
})(typeof window!=='undefined'?window:globalThis);
