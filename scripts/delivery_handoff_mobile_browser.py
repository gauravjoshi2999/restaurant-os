#!/usr/bin/env python3
"""Real mobile Chromium UX acceptance for delivery.html with synthetic RPC responses.

No production URL fetch, no Supabase key or signed-in account, no real order updates.
"""
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

class LocalFiles(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):
        pass

MOCK_SUPABASE=r"""
window.__deliveryQaStatus='Ready';
window.__deliveryQaCalls=[];
window.supabase={createClient:()=>({rpc:async(name,args)=>{
  window.__deliveryQaCalls.push(name);
  if(name==='get_delivery_handoff'){
    const entry={order_code:'QA-ONLY-OTP-001',customer_name:'Synthetic customer',
       customer_phone:'0000000000',
       delivery_address:{address_line:'Fake address',city:'Demo',postal_code:'000000'},
       restaurant_name:'QA Test Restaurant',order_status:window.__deliveryQaStatus,
       items:[{item_name:'Mock food',quantity:1,line_total:99}]};
    return {data:[entry],error:null};
  }
  if(name==='confirm_delivery_handoff'){
    return {data:args.p_otp==='1234',error:null};
  }
  return {data:null,error:{message:'Unexpected RPC'}};
}})};
"""

def check(condition,message):
    assert condition,message
    print("PASS:",message)

def main():
    host=ThreadingHTTPServer(("127.0.0.1",0),LocalFiles)
    thread=threading.Thread(target=host.serve_forever,daemon=True)
    thread.start()
    base=f"http://127.0.0.1:{host.server_port}"
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,
                                       has_touch=True,locale="hi-IN",timezone_id="Asia/Kolkata")
            page=context.new_page()
            errors=[];foreign=[]
            page.on("pageerror",lambda e:errors.append(str(e)))
            page.add_init_script(MOCK_SUPABASE)
            def route_request(route):
                url=route.request.url
                if url.startswith(base+"/"):
                    route.continue_()
                elif "supabase-js" in url and url.endswith("supabase.js"):
                    route.fulfill(status=200,content_type="text/javascript",body="")
                else:
                    foreign.append(url)
                    route.abort()
            page.route("**/*",route_request)
            token="a"*64
            page.goto(f"{base}/delivery.html?token={token}",wait_until="load")
            page.locator("#verifyCard").wait_for(state="visible")
            check(page.locator("#verifyCard").is_visible(),"OTP section is above order details")
            pos_otp=page.locator("#verifyCard").bounding_box()
            pos_detail=page.locator("#details").bounding_box()
            check(pos_otp["y"]<pos_detail["y"],"OTP appears above detailed customer data")
            check(page.locator("#otpForm").is_hidden(),"OTP blocked before handover")
            check(page.locator("#refreshDeliveryStatus").is_visible(),"Handover refresh action shown")
            check(page.locator("a[href*='delivery-test.html']").count()==0,
                  "Production page has no broken demo-testing link")
            check(page.locator("#resultMsg").is_visible(),"Helpful waiting status visible")
            check(page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
                  "No horizontal overflow on a 390px device")
            page.evaluate("window.__deliveryQaStatus='Handed Over'")
            page.locator("#refreshDeliveryStatus").click()
            check(page.locator("#otpForm").is_visible(),"Check status reveals OTP without a page reload")
            check(page.locator("#refreshDeliveryStatus").is_hidden(),"Refresh hidden after handover")
            page.locator("#otpInput").fill("0000")
            page.locator("#confirmBtn").click()
            check("sahi nahi" in page.locator("#resultMsg").inner_text(),
                  "Wrong OTP shows concise error, not a false success")
            page.locator("#otpInput").fill("1234")
            page.locator("#confirmBtn").click()
            check("successfully confirm" in page.locator("#resultMsg").inner_text(),
                  "Correct mocked OTP shows confirmation")
            check(page.locator("#otpForm").is_hidden(),"OTP input hidden after success")
            check(page.evaluate("window.__deliveryQaCalls.filter(x=>x==='confirm_delivery_handoff').length")==2,
                  "Two submits map to two mocked RPCs only")

            page.goto(base+"/delivery.html",wait_until="load")
            page.locator("#errorCard").wait_for(state="visible")
            check("adhura" in page.locator("#errorText").inner_text(),
                  "Missing token gets simple corrective guidance")
            check(page.locator("#verifyCard").is_hidden(),
                  "Missing token never shows OTP input")
            check(not errors,f"No browser runtime errors: {errors}")
            check(not foreign,f"No real external network traffic: {foreign}")
            browser.close()
    finally:
        host.shutdown()
    print("PASS: mobile delivery handoff UX, all data/RPC responses synthetic")

if __name__=="__main__":
    main()
