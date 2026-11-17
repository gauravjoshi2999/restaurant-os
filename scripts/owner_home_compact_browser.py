#!/usr/bin/env python3
"""Owner Home visual regression: all four supported mobile widths, all property modes.
Uses the existing synthetic hospitality backend, never production data.
"""
import json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
base=(ROOT/'dist/qa/owner-flow.html').read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',base).group()
for mode in ('hotel','restaurant','hybrid'):
 html=base.replace(needle,f'<script>window.__BITE_HOSPITALITY_TYPE={json.dumps(mode)};</script><script>{fixture}</script>'+needle)
 assert fixture in html
 (ROOT/f'dist/qa/home-responsive-{mode}.html').write_text(html)
server=ThreadingHTTPServer(('127.0.0.1',4198),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
report=[]
errors=[]
def check(ok,description):
 if not ok:raise AssertionError(description)
 report.append(description)
 print('PASS:',description,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in (320,360,390,430):
   for mode in ('hotel','restaurant','hybrid'):
    page=browser.new_page(viewport={'width':width,'height':880},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*.supabase.co/**',lambda r:r.abort())
    page.route('**/api.cashfree.com/**',lambda r:r.abort())
    page.goto(f'http://127.0.0.1:4198/qa/home-responsive-{mode}.html',wait_until='domcontentloaded')
    page.wait_for_function(f"document.body.dataset.businessType==='{mode}'")
    page.locator('#mainApp').wait_for(state='visible')
    page.evaluate("showPage('overview')")
    page.locator('#overview.active').wait_for(state='visible')
    try:
     page.locator('#biteV3Home .boh-feature-grid').wait_for(state='visible',timeout=5000)
    except Exception:
     debug=page.evaluate("""() => ({
       role:document.body.dataset.role,business:document.body.dataset.businessType,
       appVisible:document.getElementById('mainApp')?.getBoundingClientRect().height>0,
       v3Exists:!!document.getElementById('biteV3Home'),
       v3Visible:!!document.getElementById('biteV3Home')?.getBoundingClientRect().height,
       v3Text:document.getElementById('biteV3Home')?.innerText?.slice(0,260),
       cls:document.body.className,property:window.BiteHospitality?.prop?.()?.name,
       dashboard:typeof window.BiteOwnerReferenceV3,
       overview:document.getElementById('overview')?.className,
       nav:document.getElementById('biteOwnerBottomNav')?.innerText,
       restaurant:typeof access==='object'?access.restaurantId:'not-visible'
     })""")
     print('HOME-RESPONSIVE-DIAGNOSTIC',mode,width,debug,flush=True)
     raise
    grid=page.locator('#biteV3Home .boh-feature-grid')
    check(grid.get_attribute('data-business-type')==mode,f'{mode} {width}px correct Home mode')
    home=page.locator('#biteV3Home')
    check(home.is_visible(),f'{mode} {width}px approved Home visible')
    for unwanted in ('[data-owner-dashboard]','[data-platform-dashboard]','.od-metrics','.od-pos-breakdown','.od-finance-boundary','.od-dashboard-grid','.od-footer','#bitePremiumHome'):
     check(page.locator('#overview '+unwanted).is_hidden(),f'{mode} {width}px old Home hidden: {unwanted}')
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'{mode} {width}px no horizontal overflow')
    check(page.locator('#biteV3Home .boh-register').count()==(0 if mode=='restaurant' else 1),f'{mode} {width}px register allowed only for hotels')
    check(page.locator('#biteV3Home .boh-room').count()==(0 if mode=='restaurant' else 1),f'{mode} {width}px room status permission')
    check(page.locator('#biteV3Home .boh-pos').count()==(0 if mode=='hotel' else 1),f'{mode} {width}px POS permission')
    check(page.locator('#biteV3Home .boh-room-stat.is-cleaning').count()==0,f'{mode} {width}px no unwanted cleaning status')
    tabs=page.locator('#biteOwnerBottomNav button[data-bite-page]').evaluate_all('(els)=>els.map(e=>e.dataset.bitePage)')
    expected={'hotel':['overview','rooms','more'],
              'restaurant':['overview','orders','pos','more'],
              'hybrid':['overview','rooms','orders','pos','more']}[mode]
    check(tabs==expected,f'{mode} {width}px bottom tabs: {tabs}')
    check(all(v>=44 for v in page.locator('#biteOwnerBottomNav button').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')),f'{mode} {width}px touch targets')
    for i,card in enumerate(page.locator('#biteV3Home .boh-feature').all()):
     title=card.locator(':scope > strong')
     bounds=title.evaluate("""el=>{
       const c=el.closest('.boh-feature').getBoundingClientRect();
       const r=el.getBoundingClientRect();
       const image=el.parentElement.querySelector('.boh-card-illustration').getBoundingClientRect();
       return {inside:r.left>=c.left-1&&r.right<=c.right+1&&r.bottom<=c.bottom+1,
               separation:r.top>=image.top+image.height*.35,
               readable:getComputedStyle(el).backgroundImage!=='none',
               width:r.width,height:r.height};
     }""")
     check(bounds['inside'] and bounds['separation'] and bounds['readable'],f'{mode} {width}px card #{i+1} title clear of artwork: {bounds}')
    if mode!='restaurant':
     check('Cleaning' not in home.inner_text(),f'{mode} {width}px Housekeeping off does not show Cleaning')
    if mode=='hybrid' and width==390:
     page.locator('#biteV3Home .boh-room').click()
     page.locator('#rooms.active').wait_for(state='visible')
     check(True,'hybrid Room Status opens existing Rooms board')
    page.close()
  check(not errors,'No JavaScript page errors: '+str(errors[:3]))
  browser.close()
finally:
 server.shutdown()
print(json.dumps({'responsive_cases':len(report),'status':'PASS'}))
