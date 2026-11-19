#!/usr/bin/env python3
"""A08 mobile/desktop staff UI smoke. Synthetic records only; no production reads/writes."""
import os
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
preview=out/'owner-v3-a08-staff-preview.html'
preview.write_text("""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-staff.css">
<style>body{margin:0;font:14px system-ui,sans-serif;background:#faf9fc}
#hr{max-width:1050px;margin:0 auto;padding:12px;box-sizing:border-box}
.card{background:#fff;border-radius:16px;padding:12px;min-width:0}
</style></head>
<body data-role="owner"><main id="hr" class="v3-a08-ready" data-v3-hr-task="employee">
<section class="card" id="hrEmployeePanel"><h2>Team members</h2>
<div id="hrV3EmployeeCards"></div></section>
<section class="card" id="hrAttendancePanel"><h2>Attendance</h2>
<div id="hrV3AttendanceDay"></div></section></main>
<script src="/assets/owner-v3-staff.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4327),
 lambda *args,**kwargs:SimpleHTTPRequestHandler(*args,directory=str(ROOT),**kwargs))
Thread(target=server.serve_forever,daemon=True).start()
fixture="""() => {
 const r='11111111-1111-4111-8111-111111111111';
 const a='33333333-3333-4333-8333-333333333333';
 const b='44444444-4444-4444-8444-444444444444';
 window.__events=[];
 const rows=[
  {id:a,restaurant_id:r,full_name:'Synthetic Reception',employee_code:'SYN-01',phone:'0000000000',position:'Reception',status:'Active'},
  {id:b,restaurant_id:r,full_name:'Synthetic Cook',employee_code:'SYN-02',phone:'1111111111',position:'Cook',status:'Active'},
  {id:'55555555-5555-4555-8555-555555555555',restaurant_id:'22222222-2222-4222-8222-222222222222',full_name:'OTHER TENANT',status:'Active'}
 ];
 const attendance=[{employee_id:a,restaurant_id:r,attendance_date:'2026-10-01',status:'Half Day'}];
 window.__ok=BiteOwnerA08.render({
  cards:document.getElementById('hrV3EmployeeCards'),dayHost:document.getElementById('hrV3AttendanceDay'),
  employees:rows,attendance,restaurantId:r,date:'2026-10-01',query:'',filter:'active',role:'owner',
  onAction:(action,id)=>window.__events.push({action,id})
 });
}"""
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4327/dist/launch-qa/owner-v3-a08-staff-preview.html')
  page.evaluate(fixture)
  assert page.evaluate('window.__ok')
  cards=page.locator('#hrV3EmployeeCards')
  text=cards.inner_text()
  assert 'Synthetic Reception' in text and 'Synthetic Cook' in text
  assert 'OTHER TENANT' not in text
  assert 'Half Day' in text and 'Not marked' in text
  assert '1/2 marked' in page.locator('#hrV3AttendanceDay').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),f'Horizontal overflow {width}'
  page.locator('[data-a08-action="mark"]').first.click()
  assert page.evaluate('window.__events[0].action')=='mark'
  page.screenshot(path=str(out/f'a08-staff-{width}.png'),full_page=True)
  print('A08 browser pass',width)
  page.close()
 browser.close()
