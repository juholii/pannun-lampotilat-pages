(() => {
  'use strict';
  window.createPannuBrowserPriceService = ({ onWarning = message => console.warn(message) } = {}) => {
    const prefix = 'pannu-price-cache-v1:';
    const cooldownKey = 'pannu-price-cooldown-v1';
    let warned = false;
    const warn = () => {
      if (warned) return;
      warned = true;
      onWarning('Hintavälimuistin selaintallennus ei ole käytettävissä. Hintahaku toimii, mutta säilytä tärkeät tiedot viennillä.');
    };
    const readCooldown = () => {
      try { return Number(localStorage.getItem(cooldownKey)) || 0; }
      catch { warn(); return 0; }
    };
    const service = window.PannuPrices.createPriceService({
      requestIntervalMs: 1000,
      batchIntervalMs: 1000,
      readCache: date => JSON.parse(localStorage.getItem(`${prefix}${date}`) || 'null'),
      writeCache: (date, cached) => localStorage.setItem(`${prefix}${date}`, JSON.stringify(cached)),
      readCooldown,
      onRateLimit: until => {
        try { localStorage.setItem(cooldownKey, String(Math.max(until, readCooldown()))); }
        catch { warn(); }
      },
      onCacheError: warn
    });
    return {
      getDay(date, options = {}) {
        // Same-origin tabs share one upstream queue when Web Locks is available.
        if (navigator.locks) return navigator.locks.request('pannu-price-requests-v1', { signal: options.signal }, () => service.getDay(date, options));
        return service.getDay(date, options);
      }
    };
  };
})();
