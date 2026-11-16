/* Bite Account Center — scoped enhancement of existing authenticated account/address/support flows.
 * No fake wallet, marketing delivery or account deletion. Owner/admin systems untouched. */
(function(root){
 'use strict';
 const byId=id=>document.getElementById(id);
 const section=byId('accountView');
 if(!section||!byId('biteAccountHub'))return;
 const known=new Set(['overview','settings','profile','addresses','support','preferences','notifications','about']);
 const state={userId:null,sessionUser:null,profile:null,epoch:0,subpage:'overview',saving:false,preferenceBusy:false,emailBusy:false,deletionBusy:false,exportBusy:false};
 const titles={overview:'Your account',settings:'Account settings',profile:'Edit profile',addresses:'Saved addresses',support:'Help & support',preferences:'Food preferences',notifications:'Notifications',about:'About Bite'};
 function sameUser(id=state.userId){return Boolean(id)&&id===state.userId;}
 function text(id,value){const el=byId(id);if(el)el.textContent=String(value??'');}
 function profileName(){return String(state.profile?.full_name||state.sessionUser?.user_metadata?.full_name||'Customer').trim();}
 function renderProfile(){
   const name=profileName();
   text('biteAccountName',name);
   text('biteAccountAvatar',name.charAt(0).toUpperCase()||'B');
   text('biteAccountEmail',state.sessionUser?.email||'Signed in');
   const editorName=byId('biteProfileName');
   if(editorName&&document.activeElement!==editorName)editorName.value=name==='Customer'?'':name;
   const phone=byId('biteProfilePhone');
   if(phone&&document.activeElement!==phone)phone.value=state.profile?.phone||'';
   const email=byId('biteProfileEmail');
   if(email)email.value=state.sessionUser?.email||'';
 }
 function getPrefs(user=state.sessionUser){
   const stored=user?.user_metadata?.bite_preferences_v1;
   return {veg_only:stored?.veg_only===true,appearance:['light','dark','system'].includes(stored?.appearance)?stored.appearance:'system',reduced_motion:stored?.reduced_motion===true};
 }
 function updateVegUI(){
   const toggle=byId('biteAccountVeg');
   if(toggle)toggle.checked=getPrefs().veg_only;
   const appearance=byId('biteAccountAppearance');
   if(appearance)appearance.value=getPrefs().appearance;
   const motion=byId('biteAccountReduceMotion');
   if(motion)motion.checked=getPrefs().reduced_motion;
 }
 function applyVisualPreferences(){
   const prefs=getPrefs();
   document.documentElement?.setAttribute?.('data-bite-account-appearance',prefs.appearance);
   document.documentElement?.setAttribute?.('data-bite-reduce-motion',prefs.reduced_motion?'true':'false');
 }
 async function saveVisualPreference(event){
   const control=event.currentTarget;
   if(state.preferenceBusy){updateVegUI();return;}
   const id=state.userId,epoch=state.epoch;
   if(!id){updateVegUI();return;}
   const requested=control.id==='biteAccountAppearance'?{appearance:control.value}:{reduced_motion:control.checked};
   if(requested.appearance&&!['light','dark','system'].includes(requested.appearance)){updateVegUI();return;}
   state.preferenceBusy=true;control.disabled=true;text('biteAccountVisualMessage','Saving your settings…');
   try{
     const verified=await sb.auth.getUser();
     if(verified.error)throw verified.error;
     if(!sameUser(id)||epoch!==state.epoch||verified.data?.user?.id!==id)throw new Error('Account changed.');
     const prior=verified.data.user?.user_metadata?.bite_preferences_v1||{};
     const next={...prior,...requested};
     const result=await sb.auth.updateUser({data:{bite_preferences_v1:next}});
     if(result.error)throw result.error;
     if(!sameUser(id)||epoch!==state.epoch)return;
     state.sessionUser=result.data.user||{...state.sessionUser,user_metadata:{...state.sessionUser?.user_metadata,bite_preferences_v1:next}};
     updateVegUI();applyVisualPreferences();
     text('biteAccountVisualMessage','Preferences saved to your Bite account.');
   }catch(error){
     if(sameUser(id)&&epoch===state.epoch){updateVegUI();text('biteAccountVisualMessage','Could not save settings. Please retry.');}
   }finally{state.preferenceBusy=false;control.disabled=false;}
 }
 function applyVegMode(){
   const on=getPrefs().veg_only;
   const discovery=byId('discoveryDiet');
   if(discovery&&discovery.value!==(on?'veg':'all')){
     discovery.value=on?'veg':'all';
     discovery.dispatchEvent(new Event('change',{bubbles:true}));
   }
   const menu=byId('menuVegToggle');
   if(menu&&menu.checked!==on){
     menu.checked=on;
     menu.dispatchEvent(new Event('change',{bubbles:true}));
   }
 }
 function show(next){
   if(next==='favorites'){
     if(typeof showCustomerView==='function')showCustomerView('home');
     const favourite=byId('filterFavourites');
     if(favourite&&favourite.getAttribute('aria-pressed')!=='true')favourite.click();
     root.scrollTo?.({top:0,behavior:'instant'});
     return;
   }
   if(next==='orders'){
     const tab=document.querySelector('#homeBottomNav [data-nav="orders"]');
     if(tab)tab.click();
     return;
   }
   if(next==='logout'){byId('accountLogoutBtn')?.click();return;}
   if(!known.has(next))return;
   state.subpage=next;
   section.dataset.section=next;
   const heading=byId('accountPageTitle');if(heading)heading.textContent=titles[next];
   const back=byId('accountBackBtn');if(back)back.textContent=next==='overview'?'← Explore':'← Account';
   if(next==='profile'){renderProfile();text('biteProfileMessage','');}
   if(next==='settings'){text('biteSettingsActionMessage','');}
   if(next==='preferences'){updateVegUI();applyVisualPreferences();text('biteAccountVegMessage','');text('biteAccountVisualMessage','');}
   if(next==='support'&&!byId('customerSupportCategory')?.value)byId('customerSupportCategory').value='Account';
   root.scrollTo?.({top:0,behavior:'instant'});
 }
 async function saveProfile(event){
   event.preventDefault();
   if(state.saving)return;
   const name=byId('biteProfileName')?.value.trim()||'';
   const phone=(byId('biteProfilePhone')?.value||'').replace(/[\s()+-]/g,'');
   if(name.length<2||name.length>80||phone&&!/^\d{10,15}$/.test(phone)){
     text('biteProfileMessage','Enter a name (2–80 characters) and a valid 10–15 digit mobile number.');return;
   }
   const id=state.userId,epoch=state.epoch,saveButton=byId('biteProfileSave');
   if(!id)return;
   state.saving=true;saveButton.disabled=true;text('biteProfileMessage','Saving changes…');
   try{
     const verified=await sb.auth.getUser();
     if(verified.error)throw verified.error;
     if(!sameUser(id)||epoch!==state.epoch||verified.data?.user?.id!==id)throw new Error('Account changed. Please reopen your profile.');
     const response=await sb.from('customer_contact_profiles')
      .upsert({customer_id:id,full_name:name,phone:phone||null,updated_at:new Date().toISOString()},{onConflict:'customer_id'})
      .select('full_name,phone').single();
     if(response.error)throw response.error;
     if(!sameUser(id)||epoch!==state.epoch)return;
     state.profile=response.data;
     renderProfile();
     // The contact profile is the source of truth for checkout and account details.
     // Auth metadata sync is best-effort; never incorrectly report the database write as failed.
     const sync=await sb.auth.updateUser({data:{full_name:name}});
     if(!sameUser(id)||epoch!==state.epoch)return;
     if(!sync.error&&sync.data?.user)state.sessionUser=sync.data.user;
     renderProfile();
     const legacy=byId('accountProfile');
     if(legacy){
       const strong=legacy.querySelector('strong');
       if(strong)strong.textContent=name;
     }
     text('biteProfileMessage',sync.error?'Profile saved. Your login display name may update on your next sign-in.':'Profile saved successfully.');
   }catch(error){
     if(sameUser(id)&&epoch===state.epoch)text('biteProfileMessage',error.message||'Could not save your profile. Please retry.');
   }finally{
     state.saving=false;if(saveButton)saveButton.disabled=false;
   }
 }
 async function saveVeg(event){
   const control=event.currentTarget;
   if(state.preferenceBusy){control.checked=!control.checked;return;}
   const id=state.userId,epoch=state.epoch,requested=control.checked;
   if(!id){control.checked=!requested;return;}
   state.preferenceBusy=true;control.disabled=true;text('biteAccountVegMessage','Saving preference…');
   try{
     const verified=await sb.auth.getUser();
     if(verified.error)throw verified.error;
     if(!sameUser(id)||epoch!==state.epoch||verified.data?.user?.id!==id)throw new Error('Account changed. Please reopen settings.');
     const prior=verified.data.user?.user_metadata?.bite_preferences_v1||{};
     const next={...prior,veg_only:requested};
     const response=await sb.auth.updateUser({data:{bite_preferences_v1:next}});
     if(response.error)throw response.error;
     if(!sameUser(id)||epoch!==state.epoch)return;
     state.sessionUser=response.data.user||{...state.sessionUser,user_metadata:{...state.sessionUser?.user_metadata,bite_preferences_v1:next}};
     applyVegMode();
     text('biteAccountVegMessage',requested?'Vegetarian mode enabled for discovery and menu browsing.':'Vegetarian mode disabled.');
   }catch(error){
     if(sameUser(id)&&epoch===state.epoch){
       control.checked=!requested;
       text('biteAccountVegMessage','Could not save your preference. Please retry.');
     }
   }finally{state.preferenceBusy=false;control.disabled=false;}
 }
 async function requestEmailChange(event){
   event.preventDefault();
   if(state.emailBusy)return;
   const desired=byId('biteEmailChangeTo')?.value.trim().toLowerCase()||'';
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(desired)||desired.length>254){
     text('biteEmailChangeStatus','Please enter a valid email address.');return;
   }
   if(desired===String(state.sessionUser?.email||'').toLowerCase()){
     text('biteEmailChangeStatus','This is already your login email.');return;
   }
   const id=state.userId,epoch=state.epoch,button=byId('biteEmailChangeSubmit');
   if(!id)return;
   state.emailBusy=true;button.disabled=true;
   text('biteEmailChangeStatus','Requesting verification…');
   try{
     const verified=await sb.auth.getUser();
     if(verified.error)throw verified.error;
     if(!sameUser(id)||epoch!==state.epoch||verified.data?.user?.id!==id)throw new Error('Account changed. Please reopen settings.');
     const result=await sb.auth.updateUser({email:desired});
     if(result.error)throw result.error;
     if(!sameUser(id)||epoch!==state.epoch)return;
     // Do not announce that an email was changed: confirmation may still be required.
     text('biteEmailChangeStatus','Verification requested. Check your email inbox for any required confirmation links before using the new address.');
   }catch(error){
     if(sameUser(id)&&epoch===state.epoch)text('biteEmailChangeStatus',error.message||'Could not request email change.');
   }finally{state.emailBusy=false;button.disabled=false;}
 }
 async function requestDeletion(){
   if(state.deletionBusy||!state.userId)return;
   if(!root.confirm('Request deletion of your Bite account? Orders may be restricted while your request and financial records are reviewed. This does not delete the account immediately.'))return;
   const id=state.userId,epoch=state.epoch,button=byId('biteRequestAccountDeletion');
   state.deletionBusy=true;button.disabled=true;
   text('biteProfileMessage','Submitting your deletion request…');text('biteSettingsActionMessage','Submitting deletion request for review…');
   try{
     const verified=await sb.auth.getUser();
     if(verified.error)throw verified.error;
     if(!sameUser(id)||epoch!==state.epoch||verified.data?.user?.id!==id)throw new Error('Account changed. Please reopen your profile.');
     // Existing server-side RPC verifies auth.uid and rejects business/admin identities.
     const response=await sb.rpc('bite_request_account_deletion');
     if(response.error)throw response.error;
     if(sameUser(id)&&epoch===state.epoch)text('biteProfileMessage','Account deletion request recorded. Your account has not been deleted. Support will review your request and required records.');text('biteSettingsActionMessage','Deletion request recorded for review; your account is still active.');
   }catch(error){
     if(sameUser(id)&&epoch===state.epoch)text('biteProfileMessage',error.message||'Could not submit deletion request.');text('biteSettingsActionMessage',error.message||'Could not submit deletion request.');
   }finally{state.deletionBusy=false;button.disabled=false;}
 }
 async function requestExport(){
   if(state.exportBusy||!state.userId)return;
   const id=state.userId,epoch=state.epoch,button=byId('biteDownloadAccountData');
   state.exportBusy=true;if(button)button.disabled=true;
   text('biteDataExportStatus','Preparing your private account snapshot…');text('biteSettingsActionMessage','Preparing your private account download…');
   const current=()=>sameUser(id)&&epoch===state.epoch&&
     !section.classList.contains('hidden');
   try{
     if(!root.BiteAccountExport)throw new Error('Data download is temporarily unavailable. Please refresh and retry.');
     const snapshot=await root.BiteAccountExport.buildSnapshot(sb,id,current);
     if(!current())return;
     root.BiteAccountExport.downloadSnapshot(snapshot);
     text('biteDataExportStatus','Download started. Store this private JSON file securely.');text('biteSettingsActionMessage','Download started. Keep your private file secure.');
   }catch(error){
     if(current())text('biteDataExportStatus',error.message||'Could not export your data. No file was created.');text('biteSettingsActionMessage',error.message||'Could not export your data.');
   }finally{
     state.exportBusy=false;if(button)button.disabled=false;
   }
 }
 function requestSupport(kind){
   show('support');
   const category=byId('customerSupportCategory');
   if(category)category.value='Account';
   const subject=byId('customerSupportSubject');
   const message=byId('customerSupportMessage');
   if(kind==='deletion'){
     if(subject)subject.value='Account deletion request';
     if(message)message.value='Please contact me about permanently deleting my Bite account and explain which transaction records must be retained. I understand this request does not delete the account immediately.';
   }else{
     if(subject)subject.value='Privacy / personal data request';
     if(message)message.value='Please advise how I can access or correct the personal information held in my Bite account.';
   }
   subject?.focus?.({preventScroll:true});
 }
 function handleClick(e){
   const go=e.target.closest('[data-bite-account-go]');
   if(!go||!section.contains(go))return;
   e.preventDefault();
   const destination=go.dataset.biteAccountGo;
   if(destination==='deletion')void requestDeletion();
   else if(destination==='export')void requestExport();
   else if(destination==='support'&&go.dataset.biteAccountSupportRequest)requestSupport(go.dataset.biteAccountSupportRequest);
   else show(destination);
 }
 section.addEventListener('click',handleClick);
 byId('biteProfileForm')?.addEventListener('submit',saveProfile);
 byId('biteEmailChangeForm')?.addEventListener('submit',requestEmailChange);
 byId('biteAccountVeg')?.addEventListener('change',saveVeg);
 byId('biteAccountAppearance')?.addEventListener('change',saveVisualPreference);
 byId('biteAccountReduceMotion')?.addEventListener('change',saveVisualPreference);
 // Intercept the existing Back button only for account subpages.
 byId('accountBackBtn')?.addEventListener('click',e=>{
   if(state.subpage==='overview')return;
   e.preventDefault();e.stopImmediatePropagation();show('overview');
 },true);
 sb.auth.onAuthStateChange((event,session)=>{
   const user=session?.user||null;
   if(!user){
     state.userId=null;state.sessionUser=null;state.profile=null;state.epoch++;
     document.documentElement?.removeAttribute?.('data-bite-account-appearance');
     document.documentElement?.removeAttribute?.('data-bite-reduce-motion');
     show('overview');text('biteAccountName','Welcome to Bite');text('biteAccountEmail','Your account, your way.');
     const name=byId('biteProfileName'),phone=byId('biteProfilePhone');
     if(name)name.value='';if(phone)phone.value='';
     return;
   }
   if(user.id!==state.userId){state.epoch++;state.profile=null;state.userId=user.id;}
   state.sessionUser=user;
   updateVegUI();applyVegMode();applyVisualPreferences();
   if(section.dataset.section!=='profile')renderProfile();
 });
 root.BiteAccountHub={
   vegOnly(){return getPrefs().veg_only;},
   open({user}){
     if(!user?.id)return;
     if(user.id!==state.userId){state.epoch++;state.profile=null;}
     state.userId=user.id;state.sessionUser=user;
     show('overview');renderProfile();updateVegUI();applyVegMode();applyVisualPreferences();
   },
   setProfile(profile,user){
     if(!user?.id||!sameUser(user.id))return;
     state.profile=profile||null;state.sessionUser=user;
     renderProfile();updateVegUI();
   }
 };
 sb.auth.getSession().then(({data})=>{
   const user=data?.session?.user;
   if(!user)return;
   if(user.id!==state.userId){state.epoch++;state.profile=null;state.userId=user.id;}
   state.sessionUser=user;renderProfile();updateVegUI();applyVegMode();applyVisualPreferences();
 }).catch(()=>{});
})(window);