#!/usr/bin/env python3
"""Synthetic real-Chromium smoke for Owner mobile navigation, without login or business writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
SHELL="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:Arial,sans-serif;color:#222;background:#f6f7f9}
#mainApp{min-height:100vh}.main>.top{height:60px;display:flex;align-items:center;padding:0 16px;gap:12px;background:#fff}
.sidebar-toggle{min-width:44px;min-height:44px}.main>.top>div{margin-left:auto}
.content{padding:18px}.page[hidden]{display:none}\n.grid,.form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{border:1px solid #ddd;padding:12px;min-width:0}.table-wrap{max-width:100%;overflow:auto}
.side{position:fixed;z-index:100;top:0;bottom:0;left:0;width:250px;overflow:auto;background:#fff;
transform:translateX(-110%)}.side.sidebar-open{transform:translateX(0)}
</style></head>
<body data-role="owner"><div id="mainApp"><aside class="side"><nav class="nav"><button data-page="overview">Overview</button>
<button data-page="orders">Orders</button><button data-page="pos">POS</button>
<button data-page="menu">Menu</button><button data-page="expenses">Kharcha</button>
<button data-page="reports">Reports</button></nav></aside>
<main class="main"><header class="top"><button class="sidebar-toggle" type="button">☰</button>
<strong id="pageTitle">Overview</strong><div><button>Logout</button></div></header>
<div class="content">
<section class="page active" id="overview">
<div class="od-owner-priority"><div class="od-priority-title"><strong>Live Orders</strong></div>
<div id="ownerPriorityOrders">No active orders</div></div>
<div class="od-dashboard-grid"><section class="od-panel od-accounts">Duplicate accounts shortcuts</section><section class="od-panel od-recent">Duplicate orders shortcut</section><section class="od-panel od-live"><div class="od-stages">
<button class="od-stage" type="button">New</button><button class="od-stage" type="button">Preparing</button>
<button class="od-stage" type="button">Ready</button></div></section></div></section>
<section class="page" id="orders" hidden>Orders</section>
<section class="page" id="pos" hidden>POS</section>
<section class="page" id="menu" hidden>Menu</section>
<section class="page" id="expenses" hidden>Expenses</section>
<section class="page" id="reports" hidden><div class="grid section">
<div class="card"><h2>Sales by channel</h2><div class="table-wrap"><table style="width:700px"><tr><th>Channel</th><th>Orders</th><th>Sales</th></tr></table></div></div>
<div class="card"><h2>Payment mode summary</h2><div class="table-wrap"><table style="width:700px"><tr><th>Mode</th><th>Income</th><th>Outflow</th></tr></table></div></div></div></section>
<section class="page" id="hr" hidden>
<div class="grid section"><div class="card">Active employees</div><div class="card">Present</div></div>
<nav class="bite-hr-tabs" role="tablist">
<button class="bite-hr-tab" data-hr-tab="employee" role="tab" aria-selected="true" aria-controls="hrEmployeePanel">Employees</button>
<button class="bite-hr-tab" data-hr-tab="attendance" role="tab" aria-selected="false" aria-controls="hrAttendancePanel">Attendance</button>
<button class="bite-hr-tab" data-hr-tab="leave" role="tab" aria-selected="false" aria-controls="hrLeavePanel">Leave</button>
<button class="bite-hr-tab" data-hr-tab="payment" role="tab" aria-selected="false" aria-controls="hrPaymentCard">Payments</button></nav>
<div class="grid section bite-hr-editor-grid">
<div class="card" id="hrEmployeePanel" data-hr-panel="employee" data-hr-selected="true"><div class="form-row"><div class="field"><label>Name</label><input id="hrEmployeeName"></div><div class="field"><label>Mobile</label><input></div></div></div>
<div class="card" id="hrAttendancePanel" data-hr-panel="attendance"><div class="form-row"><div class="field"><label>Employee</label><select><option>QA Chef</option></select></div><div class="field"><label>Status</label><select><option>Present</option></select></div></div></div>
<div class="card" id="hrLeavePanel" data-hr-panel="leave"><input></div>
<div class="card" id="hrPaymentCard" data-hr-panel="payment"><input></div></div>
</section>
</div></main></div></body></html>"""

with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [320,360,390,430,1024]:
        page=browser.new_page(viewport={"width":width,"height":780},device_scale_factor=1)
        page.set_content(SHELL)
        page.add_style_tag(path=str(ROOT/"assets/owner-mobile-navigation.css"))
        page.add_style_tag(path=str(ROOT/"assets/owner-mobile-polish.css"))
        page.add_style_tag(path=str(ROOT/"assets/owner-more-mobile.css"))
        page.evaluate("""() => {
          window.showPage=id=>{
            document.querySelectorAll('.page').forEach(el=>{
              el.hidden=el.id!==id;el.classList.toggle('active',el.id===id);
            });
            document.getElementById('pageTitle').textContent=id==='overview'?'Overview':id;
            document.querySelector('.side').classList.remove('sidebar-open');
          };
          window.openPosFromOverview=button=>{window.showPage('pos');document.body.dataset.billOpened='yes'};
          window.toggleSidebar=open=>document.querySelector('.side').classList.toggle('sidebar-open',open===true);
          window.logout=()=>{document.body.dataset.logoutCalled='yes'};
        }""")
        page.add_script_tag(path=str(ROOT/"assets/owner-mobile-navigation.js"))
        page.add_script_tag(path=str(ROOT/"assets/owner-hr-mobile-tabs.js"))
        nav=page.locator("#biteOwnerBottomNav")
        if width<=760:
            assert nav.is_visible(),f"Owner bottom nav hidden at {width}px"
            assert page.locator('.sidebar-toggle').is_hidden(), "More is the only mobile drawer entry"
            assert page.locator('.main>.top').evaluate("(el)=>getComputedStyle(el).backgroundColor")=='rgb(53, 22, 110)'
            assert page.locator(".bite-owner-back").is_hidden()
            buttons=page.locator(".bite-owner-tab")
            assert buttons.count()==5
            for rect in buttons.evaluate_all("(els)=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))"):
                assert rect['w']>=44 and rect['h']>=44,(width,rect)
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),f"Horizontal overflow at {width}px"
            page.locator('[data-bite-page="menu"]').click()
            page.wait_for_function("document.querySelector('#menu').classList.contains('active')")
            assert page.locator(".bite-owner-back").is_visible()
            page.locator('[data-bite-page="orders"]').click()
            page.locator(".bite-owner-back").click()
            page.wait_for_function("document.querySelector('#menu').classList.contains('active')")
            page.locator(".bite-owner-back").click()
            page.wait_for_function("document.querySelector('#overview').classList.contains('active')")
            page.locator('[data-bite-page="pos"]').click()
            page.wait_for_function("document.querySelector('#pos').classList.contains('active')")
            assert page.evaluate("document.body.dataset.billOpened!=='yes'"), "POS tab must not auto-create bills"
            for tab in ['overview','orders','pos','menu']:
                assert page.locator(f'.side .nav button[data-page="{tab}"]').is_hidden(), f"{tab} repeats in More"
            assert page.locator('.side').is_hidden(), "Owner mobile must not show side drawer"
            assert page.locator('#overview .od-owner-priority .od-stages').count()==1, "Stages must be in the single live panel"
            assert page.locator('#overview .od-live').is_hidden(), "No duplicate Live Orders panel"
            page.locator('[data-bite-page="more"]').click()
            assert page.locator("#biteOwnerMoreScreen").is_visible(), "More must open inside main content"
            assert page.locator(".side.sidebar-open").count()==0, "More must never slide in sidebar"
            assert page.locator('#biteOwnerMoreScreen [data-owner-route]').count()==9
            assert page.locator('#overview').is_hidden(), "Underlying Home hidden while More open"
            assert page.locator('.bite-owner-back').is_visible(), "Back available on More"
            assert page.locator('[data-owner-route="expenses"]').is_visible()
            page.locator('[data-owner-route="expenses"]').click()
            page.wait_for_function("document.querySelector('#expenses').classList.contains('active')")
            assert page.locator("#biteOwnerMoreScreen").is_hidden()
            page.locator(".bite-owner-back").click()
            assert page.locator("#biteOwnerMoreScreen").is_visible(), "Child section Back must return to More"
            assert page.locator("#pageTitle").inner_text()=="More"
            page.locator(".bite-owner-back").click()
            page.wait_for_function("document.querySelector('#overview').classList.contains('active')")
            assert page.locator("#biteOwnerMoreScreen").is_hidden(), "Second Back returns to originating tab"
            page.locator('[data-bite-page="more"]').click()
            assert page.locator('#biteOwnerMoreScreen').is_visible()
            page.locator('.bite-owner-back').click()
            assert page.locator('#biteOwnerMoreScreen').is_hidden()
            page.locator('[data-bite-page="overview"]').click()
            assert page.locator('#overview .od-accounts').is_hidden(), "No duplicate accounts shortcuts on mobile Home"
            assert page.locator('#overview .od-recent').is_hidden(), "No duplicate orders shortcut on mobile Home"
            page.locator('[data-bite-page="more"]').click()
            page.locator('[data-owner-route="reports"]').click()
            page.wait_for_function("document.querySelector('#reports').classList.contains('active')")
            assert page.locator('#reports .grid.section').first.evaluate(
                "(el)=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1"), "Reports must be one column"
            assert page.locator('#reports .grid.section>.card').first.evaluate(
                "(el)=>el.getBoundingClientRect().width>=innerWidth-60"), "Report cards use full mobile width"
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "Reports must not overflow the page"
            page.locator('[data-bite-page="more"]').click()
            page.locator('[data-owner-route="hr"]').click()
            page.wait_for_function("document.querySelector('#hr').classList.contains('active')")
            assert page.locator('#hr .bite-hr-tabs').is_visible(), "HR tabs are visible on mobile"
            assert page.locator('#hrEmployeePanel').is_visible() and page.locator('#hrAttendancePanel').is_hidden()
            page.locator('#hrEmployeeName').fill('Pending QA edit')
            page.locator('[data-hr-tab="attendance"]').click()
            assert page.locator('#hrAttendancePanel').is_visible() and page.locator('#hrEmployeePanel').is_hidden()
            assert page.locator('#hr .form-row').nth(1).evaluate(
                "(el)=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1"), "Attendance fields use one column"
            page.locator('[data-hr-tab="employee"]').click()
            assert page.locator('#hrEmployeeName').input_value()=='Pending QA edit', "Switching tabs preserves unsaved form text"
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "HR must not overflow mobile page"
            page.locator('[data-bite-page="more"]').click()
            page.locator('.bite-more-logout').click()
            assert page.evaluate("document.body.dataset.logoutCalled==='yes'")
            page.evaluate("document.body.dataset.role='super_admin'")
            page.wait_for_function("document.getElementById('biteOwnerBottomNav').hidden")
            assert nav.is_hidden()
            assert page.locator('#biteOwnerMoreScreen').is_hidden()
        else:
            assert nav.is_hidden(),"Desktop must keep existing sidebar layout"
            assert page.locator('.side .nav button[data-page="menu"]').is_visible()
            assert page.locator(".bite-owner-back").is_hidden()
            page.evaluate("showPage('hr')")
            assert page.locator('#hr .bite-hr-tabs').is_hidden(), "Desktop HR must retain existing layout"
            assert page.locator('#hrEmployeePanel').is_visible() and page.locator('#hrAttendancePanel').is_visible(), "Both desktop HR forms remain available"
        page.close()
        print(f"PASS: Owner mobile shell at {width}px")
    browser.close()
