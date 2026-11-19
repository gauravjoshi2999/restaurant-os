#!/usr/bin/env python3
"""A08: synthetic attendance register 320–1024px; no backend data or payment writes."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
page_file=out/'owner-a08-attendance-preview.html'
page_file.write_text("""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-attendance.css"></head>
<body data-role="owner" style="font:14px system-ui;margin:0;overflow-x:hidden">
<main id="hr" style="padding:10px;max-width:1000px;margin:auto">
<h1>Staff & HR</h1><section id="hrAttendanceRegister"></section></main>
<script src="/assets/owner-v3-attendance.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4318),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
fixture="""async () => {
 const restaurant='262aaba7-f48b-4fa5-9ff6-b334ededca84',day='2026-10-01';
 const employees=[
  {id:'one',restaurant_id:restaurant,status:'Active',full_name:'Synthetic waiter',position:'Waiter'},
  {id:'two',restaurant_id:restaurant,status:'Active',full_name:'Synthetic cook',position:'Cook'}
 ];
 const records=[{id:'one-attendance',restaurant_id:restaurant,employee_id:'one',
  attendance_date:day,status:'Present',check_in:'09:00'}];
 const builder={select(){return this},eq(){return this},order(){return this},
  range(a,b){return Promise.resolve({data:records.slice(a,b+1),error:null})}};
 window.__opens=[];
 const scoped=await BiteV3Attendance.load({client:{from:()=>builder},restaurantId:restaurant,date:day,isCurrent:()=>true});
 const summary=BiteV3Attendance.summarize({employees,records:scoped,date:day,restaurantId:restaurant});
 document.getElementById('hrAttendanceRegister').innerHTML=BiteV3Attendance.html(summary);
 document.getElementById('hrAttendanceRegister').addEventListener('click',e=>{
  const btn=e.target.closest('[data-v3-attendance-employee]');
  if(btn)window.__opens.push(btn.dataset.v3AttendanceEmployee);
 });
 window.__result=summary;
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.goto('http://127.0.0.1:4318/dist/launch-qa/owner-a08-attendance-preview.html')
  page.evaluate(fixture)
  assert page.evaluate('__result.present')==1
  assert page.evaluate('__result.notMarked')==1
  root=page.locator('#hrAttendanceRegister')
  assert root.get_by_text('Not marked',exact=False).count()>0
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'overflow at {width}px'
  root.get_by_role('button',name='Mark attendance for Synthetic cook').click()
  assert page.evaluate('__opens[0]')=='two'
  page.screenshot(path=str(out/f'owner-a08-attendance-{width}.png'))
  print(f'PASS A08 attendance exact day, mark action, no missing=absent, width {width}px')
  page.close()
 browser.close()
