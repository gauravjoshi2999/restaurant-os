#!/usr/bin/env python3
"""Synthetic real-Chromium smoke for Owner mobile navigation, without login or business writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
SHELL="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;color:#222;background:#f6f7f9}
#mainApp{min-height:100vh}.main>.top{height:60px;display:flex;align-items:center;padding:0 16px;gap:12px;background:#fff}
.sidebar-toggle{min-width:44px;min-height:44px}.main>.top>div{margin-left:auto}
.content{padding:18px}.page[hidden]{display:none}
.side{position:fixed;z-index:100;top:0;bottom:0;left:0;width:250px;overflow:auto;background:#fff;
transform:translateX(-110%)}.side.sidebar-open{transform:translateX(0)}
</style></head>
<body data-role="owner"><div id="mainApp"><aside class="side"><nav class="nav">Full menu</nav></aside>
<main class="main"><header class="top"><button class="sidebar-toggle" type="button">☰</button>
<strong id="pageTitle">Overview</strong><div><button>Logout</button></div></header>
<div class="content">
<section class="page active" id="overview">Overview</section>
<section class="page" id="orders" hidden>Orders</section>
<section class="page" id="pos" hidden>POS</section>
<section class="page" id="expenses" hidden>Expenses</section>
<section class="page" id="hr" hidden>Staff</section>
</div></main></div></body></html>"""

with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [320,390,430,1024]:
        page=browser.new_page(viewport={"width":width,"height":780},device_scale_factor=1)
        page.set_content(SHELL)
        page.add_style_tag(path=str(ROOT/"assets/owner-mobile-navigation.css"))
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
        nav=page.locator("#biteOwnerBottomNav")
        if width<=760:
            assert nav.is_visible(),f"Owner bottom nav hidden at {width}px"
            assert page.locator(".bite-owner-back").is_hidden()
            buttons=page.locator(".bite-owner-tab")
            assert buttons.count()==5
            for rect in buttons.evaluate_all("(els)=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))"):
                assert rect['w']>=44 and rect['h']>=44,(width,rect)
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),f"Horizontal overflow at {width}px"
            page.locator('[data-bite-page="expenses"]').click()
            page.wait_for_function("document.querySelector('#expenses').classList.contains('active')")
            assert page.locator(".bite-owner-back").is_visible()
            page.locator('[data-bite-page="orders"]').click()
            page.locator(".bite-owner-back").click()
            page.wait_for_function("document.querySelector('#expenses').classList.contains('active')")
            page.locator(".bite-owner-back").click()
            page.wait_for_function("document.querySelector('#overview').classList.contains('active')")
            page.locator('[data-bite-page="pos"]').click()
            assert page.evaluate("document.body.dataset.billOpened==='yes'")
            page.locator('[data-bite-page="more"]').click()
            assert page.locator(".side.sidebar-open").count()==1
            page.locator(".bite-owner-drawer-logout").click()
            assert page.evaluate("document.body.dataset.logoutCalled==='yes'")
            page.evaluate("document.body.dataset.role='super_admin'")
            page.wait_for_function("document.getElementById('biteOwnerBottomNav').hidden")
            assert nav.is_hidden()
        else:
            assert nav.is_hidden(),"Desktop must keep existing sidebar layout"
            assert page.locator(".bite-owner-back").is_hidden()
        page.close()
        print(f"PASS: Owner mobile shell at {width}px")
    browser.close()
