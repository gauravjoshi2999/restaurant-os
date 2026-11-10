/* Bite WebView deployment freshness check. No automatic reload while users work. */
(function () {
  const scope = new URLSearchParams(location.search).get('bite_app');
  if (scope !== 'partner' && scope !== 'admin') return;
  const built = document.querySelector('meta[name="bite-deploy-sha"]')?.content;
  const hasStamp = Boolean(built && /^[a-f0-9]{40}$/.test(built));
  // Small read-only version label for installed-app verification.
  const versionLabel = document.createElement('div');
  versionLabel.id = 'bite-web-version';
  versionLabel.setAttribute('role', 'status');
  versionLabel.style.cssText = 'position:fixed;bottom:4px;right:5px;z-index:2147483646;font:10px system-ui;background:#17253ce8;color:white;padding:3px 6px;border-radius:5px;pointer-events:none';
  versionLabel.textContent = hasStamp ? 'Bite web ' + built.slice(0, 8) : 'Bite web: version pending';
  document.body.appendChild(versionLabel);
  let latestSeen = hasStamp ? built : '';
  let dismissed = '';
  let checking = false;
  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const response = await fetch('./bite-deploy-version.json?t=' + Date.now(), {cache:'no-store'});
      if (!response.ok) return;
      const data = await response.json();
      if (!/^[a-f0-9]{40}$/.test(data.sha)) return;
      latestSeen = data.sha;
      versionLabel.textContent = hasStamp ? ('Bite web ' + built.slice(0, 8) + (data.sha !== built ? ' · new ' + data.sha.slice(0, 8) : ' ✓')) : ('Bite web latest ' + data.sha.slice(0, 8));
      if (!hasStamp || data.sha === built || data.sha === dismissed) return;
      if (document.getElementById('bite-refresh-notice')) return;
      const notice = document.createElement('div');
      notice.id = 'bite-refresh-notice';
      notice.setAttribute('role','status');
      notice.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:13px;background:#17253c;color:#fff;border-radius:12px;box-shadow:0 5px 22px #0004;font:14px system-ui;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      const message = document.createElement('span');
      message.textContent = 'Bite ka naya website update taiyar hai. Apna kaam save karke refresh karein.';
      message.style.flex = '1 1 180px';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = 'Refresh';
      refresh.style.cssText = 'background:#e63842;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:700';
      refresh.onclick = function () { const url = new URL(location.href); url.searchParams.set('bite_web_refresh', latestSeen.slice(0, 12)); location.replace(url.href); };
      const later = document.createElement('button');
      later.type = 'button';
      later.textContent = 'Baad mein';
      later.style.cssText = 'background:transparent;color:white;border:1px solid #fff8;border-radius:8px;padding:9px';
      later.onclick = function () { dismissed = data.sha; notice.remove(); };
      notice.append(message, refresh, later);
      document.body.appendChild(notice);
    } catch (_) { /* offline: keep the current page usable */ }
    finally { checking = false; }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  setInterval(check, 120000);
  setTimeout(check, 5000);
})();
