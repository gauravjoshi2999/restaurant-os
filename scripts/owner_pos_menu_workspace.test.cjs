const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-pos-menu-workspace.css','utf8');
test('Owner Phase 3 stylesheet is loaded exactly once and scoped to owner',()=>{
 assert.equal(html.split('href="assets/owner-pos-menu-workspace.css"').length-1,1);
 const selectors=css.match(/(?:^|\n)\s*body\[data-role="owner"\][^{]+\{/g)||[];
 assert.ok(selectors.length>=9);
 assert.doesNotMatch(css,/display:\s*none\s*!important/);
});
test('POS and Menu maintain canonical existing controls and payment fields',()=>{
 for(const id of ['posNewSaleBtn','posDraftWorkspace','posRows','posOrderCount','posSalesTotal','posCollectedTotal','posDueTotal','menuSearchInput','menuCategoryFilter','menuCategoryChips','menuItemRows','posItemSummary','posPaymentSection','posBalanceAction','posWhatsAppConsent']){
  assert.match(html,new RegExp('id="'+id+'"'),'missing '+id);
 }
 assert.match(html,/onclick="openOrder\(\)"/);
 assert.match(html,/onclick="confirmPosItemInline\(\)"/);
 assert.match(html,/function changePosItemQuantity\(index,delta\)/);
});
test('Mobile workspaces keep four financial figures, accessible buttons and scrollable histories',()=>{
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/#posNewSaleBtn:focus-visible/);
 assert.match(css,/overflow-x:auto/);
 assert.match(css,/#menuSearchInput/);
});

test('R02 Hindi marks and keyboard initial Up/Down navigation are preserved',()=>{
 const vm=require('node:vm');
 const src=html.match(/function normalizePosSearch\(value\)\{[^\n]+\}/)[0];
 const normalize=vm.runInNewContext(src+';normalizePosSearch');
 assert.equal(normalize('पनीर टिक्का'),'पनीर टिक्का');
 assert.notEqual(normalize('दाल'),normalize('दल'));
 assert.match(html,/posSearchActiveIndex<0\?\(event.key==='ArrowDown'\?0:posSearchMatches.length-1\)/);
});
test('R02 selected duplicate-name menu item keeps its identity and stale requests are rejected',()=>{
 assert.match(html,/matches\.find\(item=>item.id===selectedId\)/);
 assert.match(html,/matches.length>1&&!match/);
 assert.match(html,/request!==posMenuRequest\|\|posMenuRestaurantId!==restaurantId\|\|access.restaurantId!==restaurantId\|\|currentUser\?\.id!==userId/);
});
