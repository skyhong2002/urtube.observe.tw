// Runs before page scripts so long-lived listeners/animations can share the
// current page's AbortSignal. Only same-path range/sort links are enhanced.
export const queryNavigationScript = String.raw`(()=>{
  window.urtubePageController = new AbortController();
  let rendered = location.href;
  let pending;
  let serial = 0;
  const controls = '.yt-range a, .yt-sort a';
  const loading = (busy) => {
    document.querySelector('.site-main')?.toggleAttribute('data-loading', busy);
    document.querySelector('.site-main')?.setAttribute('aria-busy', String(busy));
    const status = document.querySelector('[data-navigation-status]');
    if (status) status.textContent = busy ? (document.documentElement.lang.startsWith('zh') ? '載入中…' : 'Loading…') : '';
  };
  const refreshLinks = () => {
    const current = new URL(location.href);
    for (const link of document.querySelectorAll(controls + ', .yt-page-nav a, .site-nav a')) {
      const url = new URL(link.href);
      if (url.origin !== current.origin) continue;
      for (const name of ['lang', 'key', 'shorts', 'metric']) {
        if (current.searchParams.has(name) && !url.searchParams.has(name)
          && (url.pathname === current.pathname || link.closest('.yt-page-nav'))) {
          url.searchParams.set(name, current.searchParams.get(name));
        }
      }
      // The dashboard's local sorter changes the URL without a server render.
      if (current.searchParams.has('sort') && url.searchParams.has('sort')
        && !link.matches('[data-youtube-sort]') && !link.closest('.ch-sort')) {
        url.searchParams.set('sort', current.searchParams.get('sort'));
      }
      link.setAttribute('href', url.pathname + url.search + url.hash);
    }
  };
  const cancel = () => { serial++; pending?.abort(); loading(false); };
  addEventListener('urtube:query-updated', () => {
    cancel(); rendered = location.href; refreshLinks();
  });
  const navigate = async (url, push, focusLink) => {
    cancel();
    const id = serial;
    pending = new AbortController();
    const scroll = [scrollX, scrollY];
    loading(true);
    try {
      // Fetch every switch through normal authorization. Do not retain HTML
      // in localStorage or replay an old comparison after consent is revoked.
      const response = await fetch(url, { signal: pending.signal, credentials: 'same-origin', cache: 'no-store' });
      if (id !== serial) return;
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) {
        location.assign(response.redirected ? response.url : url); return;
      }
      const markup = await response.text();
      if (id !== serial) return;
      const page = new DOMParser().parseFromString(markup, 'text/html');
      const next = page.querySelector('.site-main');
      if (!next) { location.assign(url); return; }
      window.urtubePageController.abort();
      window.urtubePageController = new AbortController();
      if (push) history.pushState({ urtubeQuery: true }, '', url);
      rendered = location.href;
      document.title = page.title;
      document.documentElement.lang = page.documentElement.lang;
      const main = document.importNode(next, true);
      // Installed extension versions hold a reference to this exact node.
      // Preserve it across range changes, including its current sync status.
      const bridge = document.querySelector('[data-youtube-import-control]');
      const nextBridge = main.querySelector('[data-youtube-import-control]');
      if (bridge && nextBridge) nextBridge.replaceWith(bridge);
      document.querySelector('.site-main').replaceWith(main);
      const header = page.querySelector('.site-header');
      if (header) document.querySelector('.site-header').replaceWith(document.importNode(header, true));
      // Imported scripts are inert; initialize this response's charts and
      // controls in DOM order so document.currentScript retains its meaning.
      for (const old of main.querySelectorAll('script')) {
        if (old.type && old.type !== 'text/javascript') continue;
        if (old.src) continue;
        const script = document.createElement('script');
        script.textContent = old.textContent;
        old.replaceWith(script);
      }
      refreshLinks();
      dispatchEvent(new Event('urtube-youtube-import-status'));
      if (focusLink) {
        const selected = [...main.querySelectorAll(controls)].find(a => a.href === url);
        selected?.focus({ preventScroll: true });
      }
      requestAnimationFrame(() => { if (id === serial) scrollTo(...scroll); });
      dispatchEvent(new Event('urtube:page-updated'));
    } catch (error) {
      if (id === serial && error.name !== 'AbortError') location.assign(url);
    } finally {
      if (id === serial) loading(false);
    }
  };
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.(controls);
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    if (!url.searchParams.has('range') && !url.searchParams.has('sort')) return;
    event.preventDefault();
    if (url.href === location.href && rendered === location.href) { cancel(); return; }
    navigate(url.href, true, true);
  });
  addEventListener('popstate', () => {
    const previous = new URL(rendered);
    const next = new URL(location.href);
    previous.searchParams.delete('sort'); next.searchParams.delete('sort');
    if (document.querySelector('[data-youtube-sort]') && previous.href === next.href) {
      cancel();
      dispatchEvent(new CustomEvent('urtube:sort', { detail: new URL(location.href).searchParams.get('sort') || 'duration' }));
      rendered = location.href; refreshLinks();
    } else if (previous.pathname === next.pathname) navigate(location.href, false, false);
    else location.reload();
  });
  addEventListener('pagehide', cancel);
  document.addEventListener('DOMContentLoaded', refreshLinks, { once: true });
})();`;
