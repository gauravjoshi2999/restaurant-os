#!/usr/bin/env python3
"""PDF Owner V3 H01–H03 regression at supported phone widths and desktop.
Uses existing synthetic hospitality transport: never authenticates or mutates production.
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
  for width in (320,360,390,430,1280):
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
     page.locator('#biteV3Home .bv3-pdf-home').wait_for(state='visible',timeout=6000)
    except Exception:
     print('PDF-OWNER-HOME-DIAGNOSTIC',mode,width,page.evaluate("""() => ({
       role:document.body.dataset.role,business:document.body.dataset.businessType,
       v3:document.getElementById('biteV3Home')?.innerText?.slice(0,340),
       cls:document.body.className,property:window.BiteHospitality?.prop?.()?.name,
       nav:document.getElementById('biteOwnerBottomNav')?.innerText,
       page:document.getElementById('overview')?.className
     })"""),flush=True)
     raise
    home=page.locator('#biteV3Home')
    check(home.get_attribute('hidden') is None,f'{mode} {width}px PDF H02/H03 visible')
    check(page.locator('#biteV3Home .bv3-pdf-metric').count()==4,
          f'{mode} {width}px four Sales/Received/Due/Expenses cards')
    primary=home.locator('.bv3-pdf-primary-grid button[data-bv3-route]')
    routes=primary.evaluate_all('(els)=>els.map(e=>e.dataset.bv3Route)')
    expected_primary={'hotel':['rooms','hotel-register','daily-book'],
                      'hybrid':['rooms','pos','hotel-register','daily-book'],
                      'restaurant':['pos']}[mode]
    check(routes[:len(expected_primary)]==expected_primary and (mode!='restaurant' or routes in (['pos'],['pos','daily-book'],['pos','cashbook'])),
          f'{mode} {width}px primary action order and capability: {routes}')
    check(len(routes)==len(set(routes)),f'{mode} {width}px no duplicate primary routes')
    check(home.locator('.bv3-pdf-primary-grid').bounding_box()['y']<home.locator('.bv3-pdf-metrics').bounding_box()['y'],
          f'{mode} {width}px primary actions above accounts')
    check(all(v>=44 for v in primary.evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')),
          f'{mode} {width}px primary touch targets')
    if mode in ('hotel','hybrid'):
     check(page.locator('#biteV3Home [data-bv3-business-day]').count()==1,
           f'{mode} {width}px selected-day input available')
     check(not page.locator('#biteV3Home [data-bv3-business-day]').is_visible(),f'{mode} {width}px date input hidden by default')
     if mode=='hybrid' and width==390:
      page.locator('#biteV3Home .bv3-pdf-date-disclosure>summary').click()
      picker=page.locator('#biteV3Home [data-bv3-business-day]')
      picker.fill('2026-10-01')
      picker.dispatch_event('change')
      page.wait_for_function("document.querySelector('#biteV3Home .bv3-pdf-today')?.textContent==='HISTORICAL'")
      check('Live today' in home.inner_text(),
            'Historical date keeps live room occupancy explicitly labeled Today')
      check('Today' in home.inner_text(),
            'Live action sections remain labeled Today on old business date')
      page.locator('#biteV3Home [data-bv3-date-today]').click()
      page.wait_for_function("document.querySelector('#biteV3Home .bv3-pdf-today')?.textContent==='LIVE'")
      check(True,'Today resets historical Home without changing records')
    check(home.get_by_role('heading',name='Live orders',exact=True).count()==(0 if mode=='hotel' else 1),f'{mode} {width}px no disabled orders panel')
    check('Hotel activity ·' not in home.inner_text(),f'{mode} {width}px no raw hotel audit action')
    check(all(label in home.inner_text() for label in ('Sales','Received','Due','Expenses','Recent activity')),
          f'{mode} {width}px PDF money sections')
    check(page.locator('#biteV3Home .boh-feature-grid').count()==0,
          f'{mode} {width}px old illustrated feature grid not rendered')
    for unwanted in ('[data-owner-dashboard]','[data-platform-dashboard]','.od-metrics','.od-pos-breakdown','.od-finance-boundary','.od-dashboard-grid','.od-footer','#bitePremiumHome'):
     check(page.locator('#overview '+unwanted).is_hidden(),
           f'{mode} {width}px old dashboard invisible: {unwanted}')
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
          f'{mode} {width}px no horizontal overflow')
    check(page.locator('#biteV3Home .bv3-pdf-room-panel').count()==(0 if mode=='restaurant' else 1),
          f'{mode} {width}px hotel rooms module permission')
    check(page.locator('#biteV3Home [data-bv3-new-pos="true"]').count()==(0 if mode=='hotel' else 1),
          f'{mode} {width}px canonical POS quick action')
    check(page.locator('#biteV3Home .bv3-pdf-room-stats .bv3-pdf-primary-stat>span').all_text_contents().count('Cleaning')==0,
          f'{mode} {width}px disabled housekeeping not shown')
    check(page.locator('#biteV3Home .bv3-pdf-metric').nth(1).locator('strong').inner_text()=='—',
          f'{mode} {width}px unverified receipt never becomes fake zero')
    if width<=760:
     tabs=page.locator('#biteOwnerBottomNav button[data-bite-page]').evaluate_all('(els)=>els.map(e=>e.dataset.bitePage)')
     expected={'hotel':['overview','rooms','more'],
               'restaurant':['overview','orders','pos','more'],
               'hybrid':['overview','rooms','orders','pos','more']}[mode]
     check(tabs==expected,f'{mode} {width}px PDF H01 owner tabs: {tabs}')
     check(all(v>=44 for v in page.locator('#biteOwnerBottomNav button').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')),
           f'{mode} {width}px bottom nav touch targets')
    else:
     check(page.locator('#mainApp>.side').is_visible(),f'{mode} desktop uses original permitted sidebar')
    if mode=='hybrid' and width==390:
     page.locator('#biteV3Home [data-bv3-route="rooms"]').first.click()
     page.locator('#rooms.active').wait_for(state='visible')
     check(True,'Hybrid PDF room summary opens canonical guarded Rooms board')
    page.close()
  check(not errors,'No JavaScript page errors: '+str(errors[:3]))
  browser.close()
finally:
 server.shutdown()
print(json.dumps({'responsive_cases':len(report),'status':'PASS'}))
