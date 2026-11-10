/* Bite APK update notification. Never auto-installs; Android confirms installs. */
(async function(){
  const params=new URLSearchParams(location.search);
  const app=params.get('bite_app');
  const installed=Number(params.get('bite_version'));
  if(!['customer','partner','admin'].includes(app)||!Number.isSafeInteger(installed)||installed<1)return;
  try{
    const response=await fetch('./android-updates.json?ts='+Date.now(),{cache:'no-store'});
    if(!response.ok)return;
    const manifest=await response.json();
    const latest=manifest[app];
    if(!latest||!Number.isSafeInteger(latest.versionCode)||latest.versionCode<=installed)return;
    const link=new URL(latest.apkUrl,location.href);
    if(link.protocol!=='https:'||!['github.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(link.hostname))return;
    const box=document.createElement('div');
    box.setAttribute('role','status');
    box.style.cssText='position:fixed;bottom:16px;left:12px;right:12px;z-index:2147483647;background:#17253c;color:white;padding:15px;border-radius:14px;box-shadow:0 6px 24px #0005;font:14px system-ui;display:flex;align-items:center;gap:12px;flex-wrap:wrap';
    const label=document.createElement('span');
    label.textContent='Bite ka naya app update available hai (v'+latest.versionCode+').';
    label.style.flex='1';
    const update=document.createElement('a');
    update.textContent='Update';
    update.href=link.href;
    update.target='_blank';
    update.rel='noopener noreferrer';
    update.style.cssText='background:#ff693a;color:white;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700';
    const close=document.createElement('button');
    close.textContent='Baad mein';
    close.style.cssText='background:transparent;color:white;border:1px solid #fff8;padding:9px;border-radius:8px';
    close.addEventListener('click',()=>box.remove());
    box.append(label,update,close);
    document.body.appendChild(box);
  }catch(_){/* offline or unavailable manifest: app continues normally */}
})();