/* Bounded observation of the SDK session; never discard saved authentication. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.BiteOwnerSession = api;
    api.watchBoot(root.document);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function createReader(getSession, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const schedule = options.setTimeout ?? setTimeout;
    const cancel = options.clearTimeout ?? clearTimeout;
    let pending = null;
    return function readSession() {
      // A deadline stops waiting, not the SDK refresh. Reconnect must observe
      // that same pending operation rather than queue another refresh/lock.
      if (!pending) {
        const request = Promise.resolve().then(getSession);
        pending = request;
        const release = () => { if (pending === request) pending = null; };
        request.then(release, release);
      }
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = schedule(() => {
          const error = new Error('Saved login check timed out.');
          error.code = 'BITE_SESSION_TIMEOUT';
          reject(error);
        }, timeoutMs);
      });
      return Promise.race([pending, deadline]).finally(() => cancel(timer));
    };
  }

  function watchBoot(doc, options = {}) {
    if (!doc?.body) return;
    const schedule = options.setTimeout ?? setTimeout;
    schedule(() => {
      if (!doc.body.classList.contains('bite-session-check')) return;
      // Runs before CDN scripts: even a stalled script or access-context read
      // leaves a usable reload action, without exposing the private workspace.
      const recovery = doc.getElementById('biteBootRecovery');
      if (!recovery) return;
      doc.querySelectorAll('[data-bite-boot-loading]').forEach(el => { el.hidden = true; });
      recovery.hidden = false;
    }, options.timeoutMs ?? 12000);
  }

  return { createReader, watchBoot };
});
