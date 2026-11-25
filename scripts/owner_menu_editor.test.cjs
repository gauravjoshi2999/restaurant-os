'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('assets/owner-menu-editor.js','utf8');
function harness(){
 const nodes={},events={},timers=new Map();let seq=0,scope=true,closed=0,submitted=0;
 const node=id=>nodes[id]??=(function(){const handlers={},classes=new Set();return{
  value:'',disabled:false,hidden:true,isConnected:true,textContent:'',naturalWidth:100,
  addEventListener:(key,fn)=>handlers[key]=fn,fire:(key,event={})=>handlers[key]?.(event),focus(){doc.activeElement=this;},
  removeAttribute(key){delete this[key];},classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key)}
 };})();
 const names=['id','name','category_id','price','image_url','is_vegetarian','is_available','is_kids_choice','description'];
 const form=node('menuItemForm');form.dataset={menuRestaurant:'restaurant-A',menuUser:'user-A'};
 form.elements=names.map(name=>node(name));for(const name of names)form.elements[name]=node(name);
 form.elements.name.value='Paneer';form.elements.price.value='120';form.elements.image_url.value='https://images.example/saved.jpg';
 form.reset=()=>{for(const control of form.elements)control.value='';};form.requestSubmit=()=>{submitted++;};
 const doc={getElementById:node,activeElement:node('opener'),addEventListener:(key,fn)=>events[key]=fn};
 const ctx=vm.createContext({URL,document:doc,location:{href:'https://bite.example/index.html',origin:'https://bite.example'},
  addEventListener:(key,fn)=>events[key]=fn,setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),
  closeModal(){if(ctx.BiteOwnerMenuEditor.beforeClose()){node('menuItemModal').classList.remove('show');closed++;}}
 });
 vm.runInContext(source,ctx);
 const api=ctx.BiteOwnerMenuEditor;api.configure((rid,userId)=>scope&&rid==='restaurant-A'&&userId==='user-A');
 node('menuItemModal').classList.add('show');api.start();
 return {api,node,form,events,ctx,closed:()=>closed,submitted:()=>submitted,setScope:v=>scope=v,
  flush(){for(const [key,fn]of timers){timers.delete(key);fn();}},change(name,value){node(name).value=value;node(name).fire('input');}};
}
test('unchanged close succeeds; changed editor offers Save, Discard and Keep without any write',()=>{
 const x=harness();assert.equal(x.api.beforeClose(),true);
 const y=harness();y.change('name','Updated paneer');assert.equal(y.api.beforeClose(),false);
 assert.equal(y.node('menuItemCloseChoice').hidden,false);
 y.node('menuItemCloseKeep').fire('click');assert.equal(y.node('menuItemCloseChoice').hidden,true);
 assert.equal(y.form.elements.name.value,'Updated paneer');assert.equal(y.submitted(),0);
 assert.equal(y.api.beforeClose(),false);y.node('menuItemCloseDiscard').fire('click');assert.equal(y.closed(),1);assert.equal(y.submitted(),0);
 const z=harness();z.change('price','150');z.api.beforeClose();z.node('menuItemCloseSave').fire('click');assert.equal(z.submitted(),1);
});
test('pending save freezes editor and cannot be dismissed or double submitted; confirmed save closes',()=>{
 const x=harness();x.change('name','Updated paneer');const token=x.api.saving(true);
 assert.ok(x.form.elements.every(control=>control.disabled));assert.equal(x.api.beforeClose(),false);
 x.node('menuItemCloseDiscard').fire('click');x.node('menuItemCloseSave').fire('click');assert.equal(x.closed(),0);assert.equal(x.submitted(),0);
 assert.equal(x.api.saved(token),true);assert.equal(x.api.beforeClose(),true);assert.equal(x.api.saving(false,token),true);
 assert.ok(x.form.elements.every(control=>!control.disabled));
});
test('failed/zero-row save leaves draft dirty and available for recovery',()=>{
 const x=harness();x.change('price','150');const token=x.api.saving(true);x.api.saving(false,token);
 assert.equal(x.form.elements.price.value,'150');assert.equal(x.api.beforeClose(),false);
 assert.equal(x.node('menuItemCloseChoice').hidden,false);
});
test('photo preview failure keeps saved URL until explicit restore/remove and successful Save',()=>{
 const x=harness();x.change('image_url','https://images.example/new.jpg');x.flush();
 x.node('menuItemPhotoPreview').onerror();assert.equal(x.api.validate(),false);
 assert.match(x.node('menuItemPhotoStatus').textContent,/Nothing has been saved/);
 x.node('menuItemPhotoRestore').fire('click');assert.equal(x.form.elements.image_url.value,'https://images.example/saved.jpg');
 assert.equal(x.api.validate(),true,'unreachable unchanged URL must allow unrelated edits');
 x.node('menuItemPhotoRemove').fire('click');assert.equal(x.form.elements.image_url.value,'');assert.equal(x.api.validate(),true);
 assert.equal(x.api.beforeClose(),false,'removal is only a dirty form value, not a storage/server deletion');assert.equal(x.submitted(),0);
});
test('retry of the exact changed photo must load before save, with no inference about genuine dish content',()=>{
 const x=harness();x.change('image_url','https://images.example/new.jpg');x.flush();x.node('menuItemPhotoPreview').onerror();
 x.node('menuItemPhotoRetry').fire('click');x.node('menuItemPhotoPreview').onload();assert.equal(x.api.validate(),true);
 assert.match(x.node('menuItemPhotoStatus').textContent,/Check the dish and food type/);
 const stale=x.node('menuItemPhotoPreview').onload;
 x.change('image_url','https://images.example/other.jpg');stale();assert.equal(x.api.validate(),false,'late previous-image onload cannot validate a new URL');
 x.flush();x.node('menuItemPhotoPreview').onload();assert.equal(x.api.validate(),true);
});
test('unsafe protocols, cross-origin relative URLs, credentials and fragments never load',()=>{
 const x=harness();
 for(const value of ['javascript:alert(1)','data:image/svg+xml,abc','http://remote.example/x.png','//remote.example/x.png','https://user:pass@remote.example/x.png','https://remote.example/x.png#secret'])assert.equal(x.api.source(value),null,value);
 assert.equal(x.api.source('https://images.example/dish.jpg'),'https://images.example/dish.jpg');
 assert.equal(x.api.source('assets/veg.svg'),'https://bite.example/assets/veg.svg');
 assert.equal(x.api.source(''),'');
});
test('tenant/session loss clears the old editor and stale save completion cannot affect a later draft',()=>{
 const x=harness();x.change('price','150');const oldToken=x.api.saving(true);x.setScope(false);assert.equal(x.api.sync(),false);
 assert.equal(x.node('menuItemModal').classList.contains('show'),false);assert.equal(x.form.elements.name.value,'');
 x.setScope(true);x.form.elements.name.value='New draft';x.api.start();const newToken=x.api.saving(true);
 assert.equal(x.api.saved(oldToken),false);assert.equal(x.api.saving(false,oldToken),false);assert.equal(x.form.elements.name.disabled,true);
 assert.equal(x.api.saving(false,newToken),true);assert.equal(x.form.elements.name.value,'New draft');
});
test('Escape/backdrop use the same close guard and unloading a dirty editor requests browser protection',()=>{
 const x=harness();x.change('price','150');let prevented=0;
 x.events.keydown({key:'Escape',preventDefault(){prevented++;},stopPropagation(){}});
 assert.equal(x.node('menuItemCloseChoice').hidden,false);assert.equal(x.closed(),0);assert.equal(prevented,1);
 const event={preventDefault(){prevented++;}};x.events.beforeunload(event);assert.equal(event.returnValue,'');
 x.node('menuItemModal').fire('click',{target:x.node('menuItemModal')});assert.equal(x.closed(),0);
});
test('existing save handler and context lifecycle are wired; photo controls have no direct financial/storage/DB writes',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const hook of ['?.configure(','?.start()','?.validate()','?.saving(true)','saved(editorToken)','?.beforeClose()','?.sync()'])assert.ok(html.includes('BiteOwnerMenuEditor'+hook)||html.includes('BiteOwnerMenuEditor.'+hook),hook);
 assert.match(html,/function applyRoleUI\(\)\{globalThis.BiteOwnerMenuEditor\?\.sync\(\)/);
 assert.match(html,/async function fetchMenuData\(\)\{globalThis.BiteOwnerMenuEditor\?\.sync\(\)/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|\bsb\.from\(|\.rpc\(|\.storage\b|Cashfree|innerHTML|fetch\(/);
 assert.match(html,/owner-menu-editor\.js\?v=20261125-b008a/);assert.match(html,/owner-menu-editor\.css\?v=20261125-r14editor1/);
});
test('actual-modal browser evidence fixture parses before launching Chromium',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync('python3',['-c',[
  'import ast,json,pathlib',
  "tree=ast.parse(pathlib.Path('scripts/owner_menu_editor_browser.py').read_text())",
  'values={n.targets[0].id:ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Name)and n.targets[0].id in ("fixture","prefixes")}',
  "html=pathlib.Path('index.html').read_text()",
  'actual="\\n".join(next(line for line in html.splitlines() if line.startswith(prefix))for prefix in values["prefixes"])',
  'print(json.dumps(values["fixture"]+actual))'
 ].join('\n')],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.doesNotThrow(()=>new vm.Script(JSON.parse(result.stdout)));
});
