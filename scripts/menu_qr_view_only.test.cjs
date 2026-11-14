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

test('Pure Veg restaurants hide redundant vegetarian filter without hiding it for mixed menus',()=>{
 assert.match(menu,/id="vegSwitch"/);
 assert.match(menu,/id="pureVegLabel"/);
 assert.match(menu,/function pureVegMenu\(restaurant,availableItems\)/);
 assert.match(menu,/restaurant\.cuisine_tags/);
 assert.match(menu,/availableItems\.every\(item=>item\.is_vegetarian===true\)/);
 assert.match(menu,/availableItems\.some\(item=>item\.is_vegetarian===false\)/);
 assert.match(menu,/\$\('vegSwitch'\)\.hidden=isPureVeg/);
 assert.match(menu,/\$\('pureVegLabel'\)\.hidden=!isPureVeg/);
 assert.match(menu,/\.veg-switch\[hidden\]\{display:none!important\}/);
});
test('Printed permanent QR stays unchanged when live menu prices are updated',()=>{
 assert.match(card,/menuUrl\.searchParams\.set\('restaurant',restaurantId\)/);
 assert.doesNotMatch(card,/price|menu_version|updated_at/);
 assert.match(menu,/cache:'no-store'/);
 assert.match(menu,/id="refreshMenuBtn"/);
 assert.match(menu,/function loadMenu\(\{quiet=false\}=\{\}\)/);
 assert.match(menu,/document\.addEventListener\('visibilitychange'/);
 assert.match(menu,/setInterval\(\(\)=>/);
 assert.match(menu,/REFRESH_INTERVAL_MS=120000/);
 assert.match(menu,/\.select\('id,category_id,name,description,price,image_url,is_vegetarian'\)/);
 assert.match(menu,/\.textContent=money\(item\.price\)/);
 assert.match(menu,/\$\('refreshMenuBtn'\)\.addEventListener\('click',\(\)=>loadMenu\(\)\)/);
});

test('Printable QR card uses orange scan-friendly modules and full Bite branding under QR',()=>{
 assert.match(card,/colorDark:'#af450a'/);
 assert.match(card,/colorLight:'#ffffff'/);
 assert.match(card,/--orange:#fc8019/);
 assert.match(card,/class="qr-frame"/);
 assert.match(card,/class="qr-brand-block"/);
 assert.match(card,/id="biteBrandLogo" class="qr-bite-logo" src="assets\/bite-app-icon\.svg" alt="Bite logo"/);
 assert.match(card,/<strong>Bite<\/strong><span>Eat\. Repeat\.<\/span>/);
 assert.ok(card.indexOf('id="code"')<card.indexOf('class="qr-brand-block"'),
   'Bite logo and name must be below QR, not above it');
 assert.match(card,/@media print/);
 assert.match(card,/print-color-adjust:exact/);
 assert.match(card,/>Download QR Card<\/button>/);
 assert.match(card,/canvas\.width=900;canvas\.height=1200/);
 assert.match(card,/ctx\.drawImage\(qrCanvas\|\|qrImage,210,331,480,480\)/);
 assert.match(card,/ctx\.drawImage\(logo,270,891,94,94\)/);
 assert.match(card,/bite-branded-menu-qr-/);
 assert.doesNotMatch(card,/colorDark:'#1e1337'/);
});
