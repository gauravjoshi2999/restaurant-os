#!/usr/bin/env python3
"""Read-only 91 Wikimedia image URL browser-network audit for Maharani Palace.

Real Chromium image requests, no Supabase credentials/calls, no order/payment/data writes.
Reports load/decode dimensions and failures. HTTP 429/403/timeout indicate access
conditions and should not automatically be interpreted as a permanently dead image.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/"docs/launch/maharani-image-snapshot-20261116.json"
OUT=ROOT/"dist/launch-qa/maharani-photo-network-audit.json"

def main():
    obj=json.loads(MANIFEST.read_text(encoding="utf-8"))
    images=obj["images"]
    assert len(images)==91, f"Unexpected snapshot count {len(images)}, review rather than guessing"
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
        report=page.evaluate("""async items => {
            let next=0;
            const output=new Array(items.length);
            async function check(){
                while(true){
                    const i=next++;
                    if(i>=items.length)return;
                    const item=items[i];
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
            await Promise.all(Array.from({length:5},check));
            return output;
        }""",images)
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
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("IMAGE NETWORK AUDIT RESULT:",json.dumps({
        "total":len(report),"loaded":loaded,"not_loaded":len(failures),
        "outcomes":histogram,"http":status_histogram},ensure_ascii=False))
    for item in failures[:100]:
        print("CHECK IMAGE:",item["status"],item["name"],item["url"])
    print("Evidence:",OUT)
    # Intentionally do not make deployment fail due to external CDN throttling.
    # The report conveys actual success/failure counts, not a false all-green result.

if __name__=="__main__":
    main()
