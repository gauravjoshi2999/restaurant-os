/* Isolated PostgreSQL fallback: catalog/schema only, zero production rows or provider calls.
 * Install: npm install --prefix dist/launch-qa/test-engine --no-audit --no-fund @electric-sql/pglite@0.4.0
 * Requires the three read-only catalog exports in dist/launch-qa (see docs/launch/SECURITY_AND_RELEASE.md).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'dist/launch-qa');
const {PGlite}=await import(pathToFileURL(path.join(dir,'test-engine/node_modules/@electric-sql/pglite/dist/index.js')).href);
const read=async name=>JSON.parse(await fs.readFile(path.join(dir,'catalog-'+name+'.json'),'utf8'));
const [structure,routines,permissions]=await Promise.all(['structure','routines','permissions'].map(read));
const {pgcrypto}=await import(pathToFileURL(path.join(dir,'test-engine/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js')).href);
const db=new PGlite({extensions:{pgcrypto}});const qi=s=>'"'+String(s).replaceAll('"','""')+'"',table=s=>s.includes('.')?s.split('.').map(qi).join('.'):qi('public')+'.'+qi(s);
try{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;create schema extensions;grant usage on schema public,auth,storage to anon,authenticated,service_role;');
 await db.exec('create table auth.users('+structure.auth_columns.map(c=>qi(c.name)+' '+c.type+(c.name==='id'?' primary key':'')).join(',')+');create table storage.buckets(id text primary key,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;');
 await db.exec('create extension pgcrypto with schema extensions');
 for(const helper of routines.helpers)await db.exec(helper);
 for(const t of structure.tables){const columns=t.columns.map(c=>qi(c.name)+' '+c.type+(c.generated?' generated always as ('+c.default+') stored':'')+(c.notnull?' not null':''));await db.exec('create table public.'+qi(t.name)+'('+columns.join(',')+')');}
 for(const c of structure.constraints.filter(c=>['p','u'].includes(c.type)))await db.exec('alter table '+table(c.table)+' add constraint '+qi(c.name)+' '+c.definition);
 const tasks=[...routines.functions.map(f=>({name:f.identity,sql:f.definition})),...structure.views.map(v=>({name:v.name,sql:'create view public.'+qi(v.name)+' with(security_invoker=true) as '+v.definition}))];
 let remaining=tasks;
 for(let attempt=0;remaining.length&&attempt<4;attempt++){const next=[];for(const task of remaining){try{await db.exec(task.sql);}catch(error){next.push({...task,error:error.message});}}if(next.length===remaining.length)throw Error('Unresolved baseline definitions: '+JSON.stringify(next.map(t=>({name:t.name,error:t.error}))));remaining=next;}
 if(remaining.length)throw Error('Baseline dependency order did not resolve');
 for(const c of [...structure.constraints].filter(c=>!['p','u'].includes(c.type)).sort((a,b)=>(a.type==='f'?2:a.type==='c'?1:0)-(b.type==='f'?2:b.type==='c'?1:0)))await db.exec('alter table '+table(c.table)+' add constraint '+qi(c.name)+' '+c.definition);
 for(const t of structure.tables)for(const c of t.columns)if(c.default&&!c.generated)await db.exec('alter table public.'+qi(t.name)+' alter column '+qi(c.name)+' set default '+c.default);
 for(const index of structure.indexes||[])await db.exec(index);
 for(const trigger of routines.triggers||[])await db.exec(trigger);
 for(const f of routines.functions)await db.exec('revoke all on function '+f.identity+' from public');
 for(const g of permissions.function_grants||[])await db.exec('grant execute on function '+g.identity+' to '+(g.grantee==='PUBLIC'?'public':qi(g.grantee)));
 for(const p of permissions.policies||[]){const roles=p.roles.map(r=>r==='public'?'public':qi(r)).join(',');await db.exec('create policy '+qi(p.policyname)+' on public.'+qi(p.tablename)+' as '+p.permissive+' for '+p.cmd+' to '+roles+(p.qual?' using ('+p.qual+')':'')+(p.with_check?' with check ('+p.with_check+')':''));}
 for(const g of permissions.grants||[])await db.exec('grant '+g.privilege+' on public.'+qi(g.table)+' to '+(g.grantee==='PUBLIC'?'public':qi(g.grantee)));
 for(const t of structure.tables)if(t.rls)await db.exec('alter table public.'+qi(t.name)+' enable row level security');
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');
 // All data below is local synthetic test setup, never imported from Supabase.
 const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'];
 for(let i=0;i<ids.length;i++)await db.query("insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,'authenticated','authenticated',$2,'{}','{}',now()+($3::text||' seconds')::interval,now())",[ids[i],'local-'+i+'@example.invalid',i]);
 await db.query('insert into public.platform_admins(user_id) values($1)',[ids[0]]);
 await db.query("insert into public.restaurants(id,name,created_by) values('20000000-0000-4000-8000-000000000001','Bite QA local fixture A',$1),('20000000-0000-4000-8000-000000000002','Local foreign fixture B',$2)",[ids[1],ids[2]]);
 const sql=await fs.readFile(path.join(dir,'rollback-regression.sql'),'utf8');
 const results=await db.exec(sql),checks=results.at(-1)?.rows?.[0]?.checks;
 if(!Array.isArray(checks)||checks.some(c=>c.status!=='PASS'))throw Error('Regression failed: '+JSON.stringify(checks));
 const rollback=await db.query("select to_regclass('public.bite_coupons') is null as staged_schema_absent,(select not is_published from public.restaurants where name='Bite QA local fixture A') as qa_parent_private,(select count(*) from public.orders) as remaining_orders");
 if(!rollback.rows[0].staged_schema_absent||!rollback.rows[0].qa_parent_private||Number(rollback.rows[0].remaining_orders)!==0)throw Error('Rollback did not preserve the synthetic baseline');
 const hashes={};for(const name of ['structure','routines','permissions'])hashes[name]=createHash('sha256').update(await fs.readFile(path.join(dir,'catalog-'+name+'.json'))).digest('hex');
 const evidence={engine:'PGlite 0.4.0 / PostgreSQL WASM',transport:'Local PostgreSQL; live schema metadata, wholly synthetic records. Not Supabase Auth/provider acceptance.',captured_at:new Date().toISOString(),baseline_catalog_sha256:hashes,checks,rollback:rollback.rows[0]};
 await fs.writeFile(path.join(dir,'local-database-result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({engine:evidence.engine,passed:checks.length,rollback:evidence.rollback,checks}));
}catch(error){console.error('LOCAL DATABASE REGRESSION FAILED:',error.message);if(error.detail)console.error(error.detail);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
