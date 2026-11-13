'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Direct=require('../assets/bite-direct-order.js');
const restaurantId='262aaba7-f48b-4fa5-9ff6-b334ededca84';
const wrongId='97012f3c-19c5-4347-b1d3-4534f887b401';
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');

test('WhatsApp link is customer-addressed and contains ONLY source restaurant menu link',()=>{
 const url=Direct.directRestaurantUrl(restaurantId),parsed=new URL(url);
 assert.equal(parsed.origin,'https://gauravjoshi2999.github.io');
 assert.equal(parsed.pathname,'/restaurant-os/customer.html');
 assert.equal(parsed.searchParams.get('restaurant'),restaurantId);
 assert.equal(parsed.searchParams.get('direct'),'1');
 assert.equal(parsed.searchParams.has('otherRestaurant'),false);
 assert.equal(parsed.searchParams.has('token'),false);
 const msg=Direct.billMessage({restaurantId,restaurantName:'Hotel Maharani Palace',customerName:'QA customer',
  orderCode:'POS-QA',items:[{name:'Veg Thali',quantity:2,unit_price:150}],total:300,paid:250,due:50,waived:0});
 const wa=Direct.whatsAppUrl('9468456669',msg);
 const parsedWa=new URL(wa);
 assert.equal(parsedWa.origin,'https://wa.me');
 assert.equal(parsedWa.pathname,'/919468456669');
 assert.equal(parsedWa.searchParams.get('text'),msg);
 assert.match(msg,/Veg Thali × 2/);
 assert.match(msg,/Balance due: ₹50.00/);
 assert.ok(msg.includes(url));
 assert.ok(!msg.includes(wrongId));
});
test('Owner cannot create a direct link with invalid restaurant ID or unknown phone',()=>{
 for(const rid of ['','invalid','../../fake',wrongId.slice(0,-1)])assert.throws(()=>Direct.directRestaurantUrl(rid));
 for(const number of ['', '123456', '1234567890', '+911234567890', '0000000000'])assert.equal(Direct.normalizeIndianMobile(number),null);
 assert.equal(Direct.normalizeIndianMobile('+91 94684 56669'),'919468456669');
});
test('Successful POS save is required before creating a consented WhatsApp message',()=>{
 const start=owner.indexOf("document.getElementById('orderForm').addEventListener('submit'");
 const end=owner.indexOf('async function openDeliveryWhatsAppShare',start);
 const logic=owner.slice(start,end);
 assert.match(logic,/whatsapp_bill_consent/);
 assert.match(logic,/window\.BiteDirectOrder\?\.normalizeIndianMobile/);
 assert.match(logic,/if\(error\)throw error/);
 assert.match(logic,/if\(!data\)throw new Error/);
 const savedAt=logic.indexOf("if(!data)throw new Error('Order ID return");
 const shareAt=logic.indexOf("if(sharePayload)showPosWhatsAppBillDialog(sharePayload)");
 assert.ok(savedAt>0&&shareAt>savedAt,'never share an unsaved POS bill');
 assert.match(owner,/id="posWhatsAppConsent"/);
 assert.match(owner,/name="whatsapp_bill_consent"/);
});
test('Unrelated restaurant discovery and navigation are hidden in direct mode',()=>{
 assert.match(customer,/const BITE_DIRECT_MODE=BITE_DIRECT_PARAMS\.get\('direct'\)==='1'/);
 assert.match(customer,/restaurants=restaurants\.filter\(r=>r\.id===BITE_DIRECT_RESTAURANT_ID\)/);
 assert.match(customer,/searchQuery=searchQuery\.eq\('restaurant_id',BITE_DIRECT_RESTAURANT_ID\)/);
 assert.match(customer,/if\(BITE_DIRECT_MODE&&id!==BITE_DIRECT_RESTAURANT_ID\)return/);
 assert.match(customer,/if\(BITE_DIRECT_MODE&&view==='home'\)view='menu'/);
 assert.match(customer,/html\.bite-direct-order #homeView/);
 assert.match(customer,/html\.bite-direct-order #backBtn/);
 assert.match(customer,/html\.bite-direct-order #homeBottomNav/);
 assert.match(customer,/if\(BITE_DIRECT_MODE\)\{document\.title=restaurants\[0\]\.name/);
 assert.match(customer,/if\(BITE_DIRECT_MODE&&!BITE_DIRECT_RESTAURANT_ID\)/);
});
test('Direct mode order history and email signup remain inside the restaurant experience',()=>{
 assert.match(customer,/customerOrders=\(data\|\|\[\]\)\.filter\(order=>!BITE_DIRECT_MODE\|\|order\.restaurant_id===BITE_DIRECT_RESTAURANT_ID\)/);
 assert.match(customer,/emailRedirectTo:window\.location\.origin\+window\.location\.pathname\+\(BITE_DIRECT_MODE\?window\.location\.search:''\)/);
});
test('Single POS WhatsApp action targets the saved customer number and includes full itemized bill',()=>{
 const start=owner.indexOf('function showPosWhatsAppBillDialog(payload){');
 const end=owner.indexOf('function sharePosBillForOrder(id){',start);
 const logic=owner.slice(start,end);
 assert.match(logic,/helper\.whatsAppUrl\(payload\.phone,message\)/);
 assert.match(logic,/helper\.normalizeIndianMobile\(payload\.phone\)/);
 assert.match(logic,/new URL\(waUrl\)\.pathname!==\('\/'\+target\)/);
 assert.match(logic,/send\.href=waUrl/);
 assert.match(logic,/send\.textContent='WhatsApp Bill \+ Order Link bhejein'/);
 assert.match(logic,/send\.target='_self'/);
 assert.match(logic,/preview\.textContent=message/);
 assert.match(logic,/panel\.append\(header,details,preview,send,note\)/);
 assert.doesNotMatch(logic,/navigator\.share|createBillPdfFile|createBillImageFile|download\.click|sendImage|sendPdf/);
 assert.doesNotMatch(logic,/Is link par \*sirf/);
 assert.match(owner,/if\(!confirm\('Kya customer ne WhatsApp bill/);
});
test('Direct menu includes optional Explore food in your city link to full Bite marketplace',()=>{
 assert.match(customer,/id="biteExploreCityLink" href="customer\.html\?source=restaurant-direct-explore"/);
 assert.match(customer,/Explore food in your city/);
 assert.match(customer,/html\.bite-direct-order \.bite-direct-explore\{display:flex/);
 assert.match(customer,/\.bite-direct-explore\{display:none\}/);
 const u=new URL('customer.html?source=restaurant-direct-explore',Direct.directRestaurantUrl(restaurantId));
 assert.equal(u.searchParams.has('direct'),false);
 assert.equal(u.searchParams.has('restaurant'),false);
 assert.equal(u.pathname,'/restaurant-os/customer.html');
});
test('Owner/Admin login form is visually gated until a session check resolves',()=>{
 assert.match(owner,/<body data-bite-app="workspace" class="bite-session-check">/);
 assert.match(owner,/body\.bite-session-check #authScreen\{visibility:hidden!important/);
 assert.match(owner,/id="biteSessionSplash"/);
 assert.match(owner,/async function activateSession\(user\).*?document\.body\.classList\.remove\('bite-session-check'\)/s);
 assert.match(owner,/else \{setAuthMode\(false\);document\.body\.classList\.remove\('bite-session-check'\)\}/);
 assert.match(owner,/function showRecoveryPanel\(\)\{document\.body\.classList\.remove\('bite-session-check'\)/);
 assert.match(owner,/function showAuthError\(msg\)\{document\.body\.classList\.remove\('bite-session-check'\)/);
});
test('Branded marketing caption welcomes customer and has only the original restaurant ordering link',()=>{
 const p={restaurantId,restaurantName:'Hotel Maharani Palace',customerName:'Rahul',orderCode:'POS-123',
  items:[{name:'Veg Thali',quantity:2,unit_price:150}],total:300,paid:300,due:0,waived:0};
 const msg=Direct.marketingMessage(p);
 assert.match(msg,/Rahul/);
 assert.match(msg,/Agli baar restaurant aaye bina/);
 assert.doesNotMatch(msg,/sirf Hotel Maharani Palace/);
 assert.match(msg,/neeche item-wise details hain/i);
 assert.ok(msg.includes(Direct.directRestaurantUrl(restaurantId)));
 assert.ok(!msg.includes(wrongId));
 const f=Direct.fileName(p,'pdf');
 assert.match(f,/Hotel-Maharani-Palace-POS-123\.pdf/);
 assert.equal(Direct.canNativeShare({name:'bill.pdf'},{
   canShare:x=>x.files.length===1,share:()=>Promise.resolve()
 }),true);
 assert.equal(Direct.canNativeShare({name:'bill.pdf'},{canShare:()=>true}),false);
});

test('Direct restaurant page has prominent inline Menu CTA wired to scroll to dishes',()=>{
 assert.match(customer,/id="biteMenuInlineCTA" class="bite-menu-inline-cta" type="button"/);
 assert.match(customer,/html\.bite-direct-order \.bite-menu-inline-cta\{/);
 assert.match(customer,/browse\.scrollIntoView\(\{behavior:/);
 assert.match(customer,/\$\('biteMenuInlineCTA'\)\?\.addEventListener\('click',goToRestaurantMenu\)/);
 assert.match(customer,/aria-controls="biteMenuBrowseStart"/);
});
