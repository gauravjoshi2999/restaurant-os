/* Public discovery rules shared by the storefront and regression checks. */
(function(root){
  'use strict';
  const text=value=>String(value??'').trim().toLocaleLowerCase('en-IN');
  function isClosed(r,now=Date.now()){
    if(r.is_temporarily_closed&&(!r.temporary_closure_until||new Date(r.temporary_closure_until).getTime()>now))return true;
    if(!r.opening_time||!r.closing_time||r.opening_time===r.closing_time)return false;
    const seconds=value=>{
      const m=String(value).match(/^(\d{2}):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/);
      if(!m||Number(m[1])>24||(Number(m[1])===24&&(Number(m[2])||Number(m[3]||0))))return null;
      return Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0);
    };
    const open=seconds(r.opening_time),close=seconds(r.closing_time);
    if(open===null||close===null||open===close)return false;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(now));
    const clock=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    const current=Number(clock.hour)*3600+Number(clock.minute)*60+Number(clock.second);
    return open<close?!(current>=open&&current<close):!(current>=open||current<close);
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
    const aliases={'north indian':['thali','dal','paneer','roti','naan','curry','pulao','biryani'],'south indian':['dosa','idli','uttapam','vada','sambhar'],chinese:['noodle','chowmein','manchurian','schezwan','fried rice','hakka'],desserts:['ice cream','kulfi','halwa','gulab','rasgulla','kheer','sweet'],'fast food':['burger','sandwich','fries','pizza','momos','snack','pav']};
    const categoryDish=i=>category!=='all'&&[category,...(aliases[category]||[])].some(term=>text(i.name+' '+(i.description||'')).includes(term));
    const matches=restaurants.map(restaurant=>({restaurant,dishes:items.filter(i=>i.restaurant_id===restaurant.id&&(q?(text(i.name).includes(q)||text(i.description).includes(q)):categoryDish(i))).slice(0,2)}))
      .filter(({restaurant:r,dishes})=>{
        const tags=r.cuisine_tags||[];
        if(options.pin&&options.service!=='pickup'&&r.serviceable!==true)return false;
        if(options.openNow&&isClosed(r))return false;
        if(Number(r.average_rating||0)<Number(options.minRating||0))return false;
        if(options.favourites&&!options.favourites.has(r.id))return false;
        if(options.diet==='veg'&&!r.has_veg)return false;
        if(options.diet==='nonveg'&&!r.has_nonveg)return false;
        if(category!=='all'&&!tags.some(t=>text(t).includes(category))&&!items.some(i=>i.restaurant_id===r.id&&categoryDish(i)))return false;
        if(options.service==='delivery'&&(!r.accepts_delivery||r.delivery_paused||isClosed(r)))return false;
        if(options.service==='pickup'&&(!r.accepts_pickup||isClosed(r)))return false;
        return !q||text([r.name,r.city,r.public_description,...tags].join(' ')).includes(q)||dishes.length>0;
      });
    return matches.sort((a,b)=>{
      const closed=Number(isClosed(a.restaurant))-Number(isClosed(b.restaurant));
      if(closed)return closed;
      // Explicit sorts precede proximity. Missing prices/fees sort last.
      if(options.sort==='rating')return Number(b.restaurant.average_rating||0)-Number(a.restaurant.average_rating||0);
      if(options.sort==='price')return (a.restaurant.price_from==null?Infinity:Number(a.restaurant.price_from))-(b.restaurant.price_from==null?Infinity:Number(b.restaurant.price_from));
      if(options.sort==='delivery_fee')return Number(a.restaurant.zone_delivery_fee??a.restaurant.default_delivery_fee??Infinity)-Number(b.restaurant.zone_delivery_fee??b.restaurant.default_delivery_fee??Infinity);
      if(options.fast){const prep=r=>Number(r.estimated_prep_minutes)>0?Number(r.estimated_prep_minutes):Infinity;return prep(a.restaurant)-prep(b.restaurant);}
      if(options.sort==='recommended'&&!!a.restaurant.featured!==!!b.restaurant.featured)return a.restaurant.featured?-1:1;
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
