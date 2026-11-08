import { createClient } from "npm:@supabase/supabase-js@2";
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(s:number,v:Record<string,unknown>)=>new Response(JSON.stringify(v),{status:s,headers:{...C,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v||"").trim().replaceAll(" ","").replaceAll("-","").replaceAll("(","").replaceAll(")","");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(req.method!=="POST")return out(405,{error:"Method not allowed."});
 try{
  const h=req.headers.get("Authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"";
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!t||!url||!key||!service)return out(401,{error:"Super Admin login required."});
  const caller=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:h}}});
  const {data:u,error:ue}=await caller.auth.getUser(t);if(ue||!u.user)return out(401,{error:"Admin session expired."});
  const {data:ok,error:oe}=await caller.rpc("is_platform_admin");if(oe||ok!==true)return out(403,{error:"Only Super Admin can create Owner logins."});
  const b=await req.json(),raw=clean(b.phone),digits=raw.startsWith("+91")?raw.slice(3):raw;
  const rid=String(b.restaurantId||"").trim(),name=String(b.fullName||"").trim();
  if(digits.length!==10||digits[0]<"6"||digits[0]>"9"||![...digits].every(ch=>ch>="0"&&ch<="9"))return out(400,{error:"Valid 10-digit Indian mobile number required."});
  if(rid.length!==36||!name||name.length>120)return out(400,{error:"Restaurant and owner name are required."});
  const phone="+91"+digits,email="owner-91"+digits+"@restaurantos.test";
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:r,error:re}=await admin.from("restaurants").select("id,name").eq("id",rid).maybeSingle();if(re||!r)return out(404,{error:"Restaurant not found."});
  let found:any=null,legacy:any=null;
  for(let page=1;page<=20;page++){const {data:d,error:e}=await admin.auth.admin.listUsers({page,perPage:500});if(e)return out(500,{error:"Could not check existing accounts."});found=d.users.find((x:any)=>(x.email||"").toLowerCase()===email)||null;legacy=d.users.find((x:any)=>x.phone===phone)||null;if(found||legacy||d.users.length<500)break;}
  if(!found&&legacy)return out(409,{error:"This number has an older Phone Auth account; migration is required. No change made."});
  let uid=found?.id||"",temp="",created=false;
  if(!found){const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);temp=Array.from(bytes,x=>chars[x%chars.length]).join("");
   const {data:d,error:e}=await admin.auth.admin.createUser({email,password:temp,email_confirm:true,user_metadata:{full_name:name,login_phone:phone,auth_method:"phone_password_alias"},app_metadata:{must_change_password:true}});
   if(e||!d.user){console.error("Owner creation error",e?.message);return out(400,{error:"Owner account creation failed. Confirm Email Auth is enabled."});}uid=d.user.id;created=true;
  }
  const {data:m,error:me}=await admin.from("restaurant_members").select("role").eq("restaurant_id",rid).eq("user_id",uid).maybeSingle();if(me){if(created)await admin.auth.admin.deleteUser(uid);return out(500,{error:"Could not verify restaurant access."});}
  const {data:assignedOwners,error:ownerListError}=await admin.from("restaurant_members").select("user_id").eq("restaurant_id",rid).eq("role","owner");if(ownerListError){if(created)await admin.auth.admin.deleteUser(uid);return out(500,{error:"Could not verify the restaurant Owner assignment."});}const conflictingOwners=(assignedOwners||[]).filter((x:any)=>x.user_id!==uid);if(conflictingOwners.length||(assignedOwners||[]).length>1){if(created)await admin.auth.admin.deleteUser(uid);return out(409,{error:"This restaurant already has a conflicting Owner assignment. Resolve the existing Owner mapping before adding another account."});}
  if(found){const {data:a,error:ae}=await admin.from("platform_admins").select("user_id").eq("user_id",uid).maybeSingle();if(ae||a)return out(409,{error:"This account cannot be assigned as an Owner."});if(m&&m.role!=="owner")return out(409,{error:"Account already has another role in this restaurant."});const {data:o,error:oe2}=await admin.from("restaurant_members").select("restaurant_id").eq("user_id",uid).neq("restaurant_id",rid).limit(1);if(oe2||o?.length)return out(409,{error:"Account already belongs to another restaurant."});}
  const {error:se}=await admin.from("restaurant_members").upsert({restaurant_id:rid,user_id:uid,role:"owner"},{onConflict:"restaurant_id,user_id"});if(se){if(created)await admin.auth.admin.deleteUser(uid);return out(500,{error:"Could not save Owner access."});}
  return out(200,{success:true,created,restaurantName:r.name,phone,temporaryPassword:created?temp:null});
 }catch(e){console.error("Owner login setup failed",e);return out(500,{error:"Owner login could not be completed."});}
});