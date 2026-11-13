import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const C={"Access-Control-Allow-Origin":"https://gauravjoshi2999.github.io","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const out=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...C,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v||"").trim().replace(/[ \-()]/g,"");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALIAS_DOMAIN="@restaurantos.test";
function temporaryPassword(){
 const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
 const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
 return Array.from(bytes,b=>chars[b%chars.length]).join("");
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(req.method!=="POST")return out(405,{error:"Method not allowed."});
 if(req.headers.get("origin")&&req.headers.get("origin")!=="https://gauravjoshi2999.github.io")
  return out(403,{error:"Origin not allowed."});
 try {
  const h=req.headers.get("Authorization")||"",token=h.replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_ANON_KEY")||"",
    service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!/^Bearer\s+\S+$/i.test(h)||!url||!key||!service)return out(401,{error:"Super Admin login required."});
  const caller=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:h}}});
  const {data:auth,error:authError}=await caller.auth.getUser(token);
  if(authError||!auth.user)return out(401,{error:"Admin session expired."});
  const {data:allowed,error:permissionError}=await caller.rpc("is_platform_admin");
  if(permissionError||allowed!==true)return out(403,{error:"Only Super Admin can manage Owner logins."});
  let b:any;try{b=await req.json()}catch{return out(400,{error:"Invalid request body."})}
  const rid=String(b.restaurantId||"").trim(),name=String(b.fullName||"").trim(),
    raw=clean(b.phone),digits=raw.startsWith("+91")?raw.slice(3):raw;
  const replace=b.replaceExistingOwner===true;
  const expectedOwnerId=String(b.expectedOwnerUserId||"").trim();
  const confirmation=String(b.confirmRestaurantName||"").trim();
  if(!UUID.test(rid)||name.length<2||name.length>120)return out(400,{error:"Valid restaurant and Owner full name required."});
  if(!/^[6-9][0-9]{9}$/.test(digits))return out(400,{error:"Valid 10-digit Indian mobile number required."});
  const phone="+91"+digits,email="owner-91"+digits+ALIAS_DOMAIN;
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:restaurant,error:re}=await admin.from("restaurants").select("id,name").eq("id",rid).maybeSingle();
  if(re)return out(503,{error:"Could not verify restaurant."});
  if(!restaurant)return out(404,{error:"Restaurant not found. Refresh Owner mapping and retry.",code:"RESTAURANT_NOT_FOUND"});
  const {data:owners,error:oe}=await admin.from("restaurant_members")
    .select("user_id").eq("restaurant_id",rid).eq("role","owner");
  if(oe)return out(503,{error:"Could not verify existing Owner mapping."});
  const ownerRows=owners||[];
  let previousOwnerId:string|null=null;
  if(replace){
   if(!UUID.test(expectedOwnerId)||ownerRows.length!==1||ownerRows[0].user_id!==expectedOwnerId)
    return out(409,{error:"Owner mapping changed. Refresh and review before replacing.",code:"OWNER_MAPPING_CHANGED"});
   if(confirmation!==restaurant.name)
    return out(400,{error:"Restaurant name confirmation did not match.",code:"CONFIRM_RESTAURANT_NAME"});
   previousOwnerId=ownerRows[0].user_id;
  }else if(ownerRows.length>1){
   return out(409,{error:"Multiple Owner mappings. Review and resolve conflicts before creating a login.",code:"OWNER_MAPPING_CONFLICT"});
  }else if(ownerRows.length===1){
   return out(409,{error:"Is restaurant ka Owner pehle se linked hai. Reset Password ya Replace Owner Login select karein.",code:"OWNER_EXISTS"});
  }
  // A new business may inherit existing customer/order records when a demo
  // restaurant is repurposed. Demand a separate explicit disclosure acceptance.
  const {count:oldLiveOrders,error:historyError}=await admin.from("orders")
    .select("id",{count:"exact",head:true}).eq("restaurant_id",rid).eq("is_demo",false);
  if(historyError)return out(503,{error:"Could not verify existing order history."});
  if(replace&&Number(oldLiveOrders||0)>0&&b.acknowledgeExistingHistory!==true)
   return out(409,{error:"Restaurant ke existing live orders hain. Owner change se naye Owner ko purani business history ki access mil sakti hai. Pehle history review aur confirmation karein.",code:"HISTORY_ACK_REQUIRED",existing_live_orders:oldLiveOrders});

  // A phone alias already represents a real Auth identity; never create a
  // second account with the same phone or silently reset another owner's login.
  let existing:any=null,legacy:any=null;
  for(let page=1;page<=20;page++){
   const {data:list,error:listError}=await admin.auth.admin.listUsers({page,perPage:500});
   if(listError)return out(503,{error:"Could not check existing Owner accounts."});
   existing=list.users.find((u:any)=>(u.email||"").toLowerCase()===email)||null;
   legacy=list.users.find((u:any)=>u.phone===phone)||null;
   if(existing||legacy||list.users.length<500)break;
  }
  if(!existing&&legacy)return out(409,{error:"This mobile already belongs to a Phone Auth account. Do not create a duplicate account.",code:"PHONE_AUTH_MIGRATION_REQUIRED"});
  if(existing?.id===previousOwnerId)return out(409,{error:"Yeh mobile isi Owner ka hai. Replace nahi, Reset Password use karein.",code:"SAME_OWNER"});
  if(existing){
   const {data:adminAccount,error:ae}=await admin.from("platform_admins").select("user_id").eq("user_id",existing.id).maybeSingle();
   if(ae||adminAccount)return out(409,{error:"Admin account ko Owner nahi bana sakte."});
   const {data:members,error:me}=await admin.from("restaurant_members").select("restaurant_id,role").eq("user_id",existing.id);
   if(me||members?.length)return out(409,{error:"This account already has restaurant access. Use a different verified mobile; no mapping changed.",code:"ACCOUNT_ALREADY_ASSIGNED"});
  }

  let uid=existing?.id||"",password="",created=false;
  if(!existing){
   password=temporaryPassword();
   const {data:newUser,error:createError}=await admin.auth.admin.createUser({
    email,password,email_confirm:true,
    user_metadata:{full_name:name,login_phone:phone,auth_method:"phone_password_alias"},
    app_metadata:{must_change_password:true}
   });
   if(createError||!newUser.user){
    console.error("Owner create failed",createError?.message);
    return out(409,{error:"Owner account could not be created. Check if mobile alias already exists.",code:"OWNER_CREATE_FAILED"});
   }
   uid=newUser.user.id;created=true;
  }
  let assigned=false;
  if(replace){
   // Existing admin-only SQL RPC switches the Owner atomically, audit logs the
   // previous mapping, and prevents duplicate Owner access in one transaction.
   const {data:ok,error:resolveError}=await caller.rpc("admin_resolve_owner_mapping",{
     p_user_id:uid,p_restaurant_id:rid
   });
   assigned=!resolveError&&ok===true;
   if(!assigned)console.error("Owner replacement RPC failed",resolveError?.message);
  }else{
   const {error:membershipError}=await admin.from("restaurant_members")
     .insert({restaurant_id:rid,user_id:uid,role:"owner"});
   assigned=!membershipError;
   if(!assigned)console.error("Owner mapping insert failed",membershipError?.message);
  }
  if(!assigned){
   if(created)await admin.auth.admin.deleteUser(uid);
   return out(409,{error:"Owner mapping could not be saved. Original owner remains unchanged; refresh and retry.",code:"MAPPING_FAILED"});
  }
  if(replace&&previousOwnerId){
   // Remove stale FCM registration for the previous Owner. This cannot give
   // the previous Owner access back even if a device has a cached session.
   const {error:disableError}=await admin.from("bite_owner_push_devices")
      .update({enabled:false,updated_at:new Date().toISOString()})
      .eq("restaurant_id",rid).eq("user_id",previousOwnerId);
   if(disableError)console.error("Old device disable pending",disableError.message);
  }
  console.info("Owner login assigned",{restaurant_id:rid,actor:auth.user.id,replaced:replace,created});
  return out(200,{
   success:true,created,replaced:replace,
   restaurantName:restaurant.name,phone,
   temporaryPassword:created?password:null,
   existingLiveOrders:Number(oldLiveOrders||0),
   needsPasswordReset:!created
  });
 }catch(e){
  console.error("Owner login setup failed",e instanceof Error?e.message:"Unexpected error");
  return out(500,{error:"Owner login could not be completed. No automatic retry performed."});
 }
});
