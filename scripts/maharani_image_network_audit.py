#!/usr/bin/env python3
"""Read-only 91 Wikimedia image URL browser-network audit for Maharani Palace.

Real Chromium image requests, no Supabase credentials/calls, no order/payment/data writes.
Reports load/decode dimensions and failures. HTTP 429/403/timeout indicate access
conditions and should not automatically be interpreted as a permanently dead image.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/"docs/launch/maharani-image-snapshot-20261116.json"
OUT=ROOT/"dist/launch-qa/maharani-photo-network-audit.json"

def main():
    obj=json.loads(MANIFEST.read_text(encoding="utf-8"))
    parser=argparse.ArgumentParser()
    parser.add_argument("--spotcheck",action="store_true",help="Retest 7 previously failed URLs from a fresh runner, one at a time")
    parser.add_argument("--concurrency",type=int,default=1,help="At most 2 bounded image requests at once; default serial to limit CDN throttling")
    parser.add_argument("--delay-ms",type=int,default=900,help="Wait at least 250 ms before each image load; default 900 ms")
    parser.add_argument("--start",type=int,default=0,help="Start offset for a bounded full-list audit (zero-based)")
    parser.add_argument("--limit",type=int,default=91,help="Maximum consecutive images to inspect; a subset is not a full audit")
    args=parser.parse_args()
    if not 1<=args.concurrency<=2:parser.error("--concurrency must be 1 or 2")
    if not 250<=args.delay_ms<=5000:parser.error("--delay-ms must be between 250 and 5000")
    if args.spotcheck and (args.start!=0 or args.limit!=91):parser.error("--spotcheck cannot be combined with --start/--limit")
    all_images=obj["images"]
    assert len(all_images)==91, f"Unexpected snapshot count {len(all_images)}, review rather than guessing"
    if not 0<=args.start<len(all_images):parser.error("--start is outside the 91-image manifest")
    if not 1<=args.limit<=len(all_images):parser.error("--limit must be between 1 and 91")
    indices=[33,40,50,60,70,80,90]
    images=[all_images[i] for i in indices] if args.spotcheck else all_images[args.start:args.start+args.limit]
    assert all(v["url"].startswith("https://commons.wikimedia.org/wiki/Special:FilePath/") for v in images), "Unexpected image host"
    with sync_playwright() as p:
        browser=p.chromium.launch()
        context=browser.new_context(viewport={"width":390,"height":844},
                                    device_scale_factor=1,locale="hi-IN",timezone_id="Asia/Kolkata")
        page=context.new_page()
        statuses=[]
        page.on("response",lambda res: statuses.append({"url":res.url,"status":res.status})
                if "wikimedia.org" in res.url or "wikipedia.org" in res.url else None)
        # Load actual image elements. Keep concurrency low to avoid hammering Commons.
        report=page.evaluate("""async options => {
            const items=options.items;
            let next=0;
            const output=new Array(items.length);
            async function check(){
                while(true){
                    const i=next++;
                    if(i>=items.length)return;
                    const item=items[i];
                    if(options.delayMs)await new Promise(r=>setTimeout(r,options.delayMs));
                    output[i]=await new Promise(resolve=>{
                        const img=new Image();
                        let done=false;
                        const timeout=setTimeout(()=>{
                            if(done)return; done=true; img.src='';
                            resolve({name:item.name,url:item.url,status:'timeout',width:0,height:0});
                        },14000);
                        const finish=(status)=>{
                            if(done)return;done=true;clearTimeout(timeout);
                            resolve({name:item.name,url:item.url,status,
                                width:img.naturalWidth||0,height:img.naturalHeight||0});
                        };
                        img.onload=()=>finish(img.naturalWidth>0?'loaded':'zero-dimensions');
                        img.onerror=()=>finish('load-error');
                        img.referrerPolicy='no-referrer';
                        img.src=item.url;
                    });
                }
            }
            await Promise.all(Array.from({length:options.concurrency},check));
            return output;
        }""",{"items":images,"concurrency":1 if args.spotcheck else args.concurrency,
                "delayMs":1100 if args.spotcheck else args.delay_ms})
        context.close()
        browser.close()
    loaded=sum(x["status"]=="loaded" for x in report)
    failures=[x for x in report if x["status"]!="loaded"]
    histogram={}
    for x in report:
        histogram[x["status"]]=histogram.get(x["status"],0)+1
    status_histogram={}
    for x in statuses:
        k=str(x["status"]);status_histogram[k]=status_histogram.get(k,0)+1
    evidence={
        "kind":"Real Chromium browser image element loads, 390px viewport",
        "source_manifest":"docs/launch/maharani-image-snapshot-20261116.json",
        "scope":"91 current public Wikimedia photo URLs",
        "real_supabase_writes":0,
        "total":len(report),"loaded":loaded,"not_loaded":len(failures),
        "outcomes":histogram,"observed_http_statuses":status_histogram,
        "items":report,
        "limitations":"Image load does not verify actual dish, current license terms or required attribution. Browser/network failures can be temporary throttling.",
    }
    full=(not args.spotcheck and args.start==0 and len(images)==len(all_images))
    out=OUT.with_name("maharani-photo-retry-spotcheck.json") if args.spotcheck else (
        OUT if full else OUT.with_name(f"maharani-photo-audit-{args.start}-{len(images)}.json"))
    evidence["audit_mode"]="spotcheck_new_runner_serial" if args.spotcheck else ("full_bounded" if full else "partial_bounded")
    evidence["start_index"]=None if args.spotcheck else args.start
    evidence["concurrency"]=1 if args.spotcheck else args.concurrency
    evidence["delay_ms"]=1100 if args.spotcheck else args.delay_ms
    evidence["snapshot_verified_against_live_db_on"]="2026-11-25"
    evidence["scope_disclaimer"]="No image link, license or current owner approval is changed or proven by this report."
    OUT.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("IMAGE NETWORK AUDIT RESULT:",json.dumps({
        "total":len(report),"loaded":loaded,"not_loaded":len(failures),
        "outcomes":histogram,"http":status_histogram},ensure_ascii=False))
    for item in failures[:100]:
        print("CHECK IMAGE:",item["status"],item["name"],item["url"])
    print("Evidence:",out)
    # Intentionally do not make deployment fail due to external CDN throttling.
    # The report conveys actual success/failure counts, not a false all-green result.

if __name__=="__main__":
    main()
