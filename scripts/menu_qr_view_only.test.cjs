const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const menu=fs.readFileSync('menu-qr.html','utf8');
const card=fs.readFileSync('menu-qr-card.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const build=fs.readFileSync('scripts/build_static_site.py','utf8');

test('QR guest sees only chosen published restaurant menu; no login, checkout or writes',()=>{
 assert.match(menu,/new URLSearchParams\(location.search\)/);
 assert.match(menu,/UUID\.test\(restaurantId\|\|''\)/);
 assert.match(menu,/rpc\('list_public_restaurants'\)/);
 assert.match(menu,/\.find\(r=>r\.id===restaurantId\)/);
 assert.match(menu,/\.eq\('restaurant_id',restaurantId\)/);
 assert.match(menu,/\.eq\('is_available',true\)/);
 assert.match(menu,/\.eq\('is_active',true\)/);
 assert.match(menu,/\.select\('id,category_id,name,description,price,image_url,is_vegetarian'\)/);
 assert.match(menu,/document\.createElement\('article'\)/);
 assert.match(menu,/\.textContent=item.name\|\|'Dish'/);
 assert.match(menu,/new URL\(value,location.href\)/);
 assert.doesNotMatch(menu,/<form\b/i);
 assert.doesNotMatch(menu,/sb\.auth\.|\.insert\(|\.upsert\(|\.update\(|\.delete\(|placeOrder\(|proceedToCheckout\(|Cashfree\.checkout\(/);
 assert.doesNotMatch(menu,/data-add=|id="cart|id="checkout|type="submit"/);
});
test('Owner uses one permanent restaurant QR card and no QR order flow',()=>{
 assert.match(owner,/id="printMenuQrBtn"/);
 assert.match(owner,/function openRestaurantMenuQR\(\)/);
 assert.match(owner,/access\.role!=='owner'\|\|!access\.restaurantId/);
 assert.match(owner,/rid!==access\.restaurantId/);
 assert.match(owner,/new URL\('menu-qr-card\.html',location.href\)/);
 assert.match(owner,/Khana serve hone ke baad owner New POS Bill/);
 assert.match(owner,/QR se order ya Cashfree checkout nahi hota/);
 assert.match(card,/new URL\('menu-qr\.html',location.href\)/);
 assert.match(card,/new QRCode\(/);
 assert.match(card,/assets\/vendor\/qrcode\.min\.js/);
 assert.match(card,/window\.print\(\)/);
 assert.match(card,/\.textContent=r\.name\|\|'Restaurant'/);
 assert.doesNotMatch(card,/\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});
test('Static build includes both QR pages and local QR generator with its license',()=>{
 assert.match(build,/'menu-qr\.html','menu-qr-card\.html'/);
 assert.match(build,/assets\/vendor\/qrcode\.min\.js/);
 assert.ok(fs.existsSync('assets/vendor/qrcode.min.js'));
 assert.ok(fs.readFileSync('assets/vendor/qrcode.min.js','utf8').length>5000);
 assert.match(fs.readFileSync('assets/vendor/LICENSE.qrcodejs.txt','utf8'),/MIT License/);
 assert.match(owner,/owner-menu-qr\.css\?v=20261114-viewonly1/);
 assert.match(fs.readFileSync('assets/owner-menu-qr.css','utf8'),/body:not\(\[data-role="owner"\]\) #printMenuQrBtn/);
});
