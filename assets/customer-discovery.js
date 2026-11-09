/* Public discovery rules shared by the storefront and regression checks. */
(function(root){
  'use strict';
  const text=value=>String(value??'').trim().toLocaleLowerCase('en-IN');
  function isClosed(r,now=Date.now()){
    return !!(r.is_temporarily_closed&&(!r.temporary_closure_until||new Date(r.temporary_closure_until).getTime()>now));
  }
  function safeImage(value,fallback){
    if(!value)return fallback;
    try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:fallback;}catch{return fallback;}
  }
  function distance(r,geo){
    if(!geo||r.latitude==null||r.longitude==null)return null;
    const lat=Number(r.latitude),lon=Number(r.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    const rad=n=>n*Math.PI/180,dLat=rad(lat-geo.latitude),dLon=rad(lon-geo.longitude);
    const a=Math.sin(dLat/2)**2+Math.cos(rad(geo.latitude))*Math.cos(rad(lat))*Math.sin(dLon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
  }
  function selectRestaurants(restaurants,items,options={}){
    const q=text(options.query),category=text(options.category||'all');
    const matches=restaurants.map(restaurant=>({restaurant,dishes:q?items.filter(i=>i.restaurant_id===restaurant.id&&(text(i.name).includes(q)||text(i.description).includes(q))).slice(0,2):[]}))
      .filter(({restaurant:r,dishes})=>{
        const tags=r.cuisine_tags||[];
        if(category!=='all'&&!tags.some(t=>text(t).includes(category)))return false;
        if(options.service==='delivery'&&(!r.accepts_delivery||r.delivery_paused||isClosed(r)))return false;
        if(options.service==='pickup'&&(!r.accepts_pickup||isClosed(r)))return false;
        return !q||text([r.name,r.city,r.public_description,...tags].join(' ')).includes(q)||dishes.length>0;
      });
    return matches.sort((a,b)=>{
      const closed=Number(isClosed(a.restaurant))-Number(isClosed(b.restaurant));
      if(closed)return closed;
      // An explicit sort choice takes priority over proximity.
      if(options.fast){const prep=r=>Number(r.estimated_prep_minutes)>0?Number(r.estimated_prep_minutes):Infinity;return prep(a.restaurant)-prep(b.restaurant);}
      if(options.geo){const da=distance(a.restaurant,options.geo),db=distance(b.restaurant,options.geo);return (da??Infinity)-(db??Infinity);}
      return 0;
    });
  }
  function selectMenu(items,options={}){
    const q=text(options.query),category=options.category||'all';
    return items.filter(i=>(category==='all'||i.category_id===category)&&(!options.vegOnly||i.is_vegetarian===true)&&(!q||text(i.name+' '+(i.description||'')).includes(q)));
  }
  const api={isClosed,safeImage,distance,selectRestaurants,selectMenu};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BiteDiscovery=api;
})(typeof window!=='undefined'?window:globalThis);
