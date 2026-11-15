/* Bite: clearly labelled menu-based recommendations, plus owner-published kids tags.
   No tracking, inferred child suitability, fake popularity, or cross-restaurant data. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteMenuPersonalization=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function selectRecommendations(items,cart={},options={}){
  const limit=Math.max(0,Math.min(6,Number(options.limit)||6));
  if(!Array.isArray(items)||limit===0)return [];
  const eligible=items.filter(x=>x&&x.id&&x.is_available!==false&&
    Number.isFinite(Number(x.price))&&Number(x.price)>0&&Number(cart[x.id]||0)<99);
  const chosen=eligible.filter(x=>Number(cart[x.id]||0)>0);
  const exclude=new Set(chosen.map(x=>x.id));
  const categories=new Set(chosen.map(x=>x.category_id).filter(Boolean));
  const allVeg=chosen.length>0&&chosen.every(x=>x.is_vegetarian===true);
  const candidates=eligible.filter(x=>!exclude.has(x.id)&&(!allVeg||x.is_vegetarian===true));
  return candidates.map((item,index)=>({
   item,index,score:(
    (categories.size&&item.category_id&&!categories.has(item.category_id)?0:2)+
    (chosen.length===0?0:(Number(item.price)>250?1:0))
   )
  })).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,limit).map(x=>x.item);
 }
 function selectKids(items,enabled){
  return !enabled?items:Array.isArray(items)?items.filter(x=>x.is_kids_choice===true):[];
 }
 if(typeof document==='undefined')return {selectRecommendations,selectKids};
 const tools=document.querySelector('#menuView .menu-browse-tools');
 const category=document.getElementById('categoryBar');
 if(!tools||!category)return {selectRecommendations,selectKids};
 const kids=document.createElement('label');
 kids.className='bite-kids-toggle';kids.id='biteKidsChoiceToggle';kids.hidden=true;
 kids.innerHTML='<input id="biteKidsChoiceOnly" type="checkbox"><span>Kids’ Choice</span>';
 tools.append(kids);
 const panel=document.createElement('section');
 panel.id='biteMenuRecommendations';panel.className='bite-menu-recommendations';
 panel.hidden=true;panel.setAttribute('aria-labelledby','biteRecommendationsHeading');
 panel.innerHTML='<div class="bite-menu-recommendations-head"><div><h3 id="biteRecommendationsHeading">Explore more dishes</h3>'+
   '<p id="biteRecommendationsSubtitle">From this restaurant’s available menu</p></div></div>'+
   '<div class="bite-menu-recommendations-list" id="biteRecommendationsList"></div>';
 category.insertAdjacentElement('beforebegin',panel);
 const list=document.getElementById('biteRecommendationsList');
 const input=document.getElementById('biteKidsChoiceOnly');
 let lastRestaurantId=null;
 function reset(){
  input.checked=false;kids.hidden=true;panel.hidden=true;
  lastRestaurantId=null;
 }
 function renderRecommendations(items,cart,restaurant){
  if(!restaurant||!Array.isArray(items))return reset();
  if(restaurant.id!==lastRestaurantId){lastRestaurantId=restaurant.id;input.checked=false;}
  const kidsCount=items.filter(x=>x.is_kids_choice===true&&x.is_available!==false).length;
  kids.hidden=kidsCount===0;
  if(!kidsCount)input.checked=false;
  const suggestions=selectRecommendations(items,cart);
  panel.hidden=!suggestions.length;
  if(panel.hidden){list.replaceChildren();return;}
  document.getElementById('biteRecommendationsHeading').textContent=
    Object.keys(cart||{}).some(id=>Number(cart[id]||0)>0)?'Goes well with your cart':'Explore more dishes';
  list.replaceChildren();
  for(const item of suggestions){
   const article=document.createElement('article');article.className='bite-recommendation';
   const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';
   image.src=window.BiteDiscovery?.safeImage?.(item.image_url,'assets/food-placeholder.svg')||'assets/food-placeholder.svg';
   image.addEventListener('error',()=>{if(!image.src.endsWith('food-placeholder.svg'))image.src='assets/food-placeholder.svg';},{once:true});
   const info=document.createElement('div');info.className='bite-recommendation-info';
   const name=document.createElement('strong');name.textContent=item.name;
   const price=document.createElement('small');price.textContent='₹'+Number(item.price).toLocaleString('en-IN',{maximumFractionDigits:2});
   info.append(name,price);
   if(item.is_kids_choice===true){
    const tag=document.createElement('span');tag.className='bite-recommendation-kids';tag.textContent='Kids’ Choice';
    info.append(tag);
   }
   const button=document.createElement('button');button.type='button';button.dataset.biteSuggestedItem=item.id;
   button.textContent='+ Add';button.disabled=Number(cart[item.id]||0)>=99;
   button.setAttribute('aria-label','Add '+item.name+' for ₹'+Number(item.price));
   article.append(image,info,button);list.append(article);
  }
 }
 input.addEventListener('change',()=>{
  if(typeof renderMenuItems==='function')renderMenuItems();
 });
 list.addEventListener('click',event=>{
  const button=event.target.closest('button[data-bite-suggested-item]');
  if(!button||button.disabled)return;
  if(typeof menuItems==='undefined'||typeof cart==='undefined'||!activeRestaurant)return;
  const item=menuItems.find(x=>x.id===button.dataset.biteSuggestedItem);
  if(!item||item.is_available===false||Number(cart[item.id]||0)>=99)return;
  if(typeof hideCartUndo==='function')hideCartUndo();
  cart[item.id]=Number(cart[item.id]||0)+1;
  renderCart();refreshMenuQuantityControl(item.id);
  renderRecommendations(menuItems,cart,activeRestaurant);
 });
 return {selectRecommendations,selectKids,renderRecommendations,reset,isKidsChoiceSelected:()=>input.checked};
});
