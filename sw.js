/* MD 에디터 - 오프라인 캐시 서비스 워커
 * 전략
 *  - 앱 셸(같은 출처 파일): 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
 *  - CDN 라이브러리(marked, DOMPurify): 캐시 우선 (처음 한 번 받으면 오프라인에서도 동작)
 * 앱 파일을 수정하면 CACHE_VERSION 값을 올려 주세요. 그래야 기존 캐시가 교체됩니다.
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `md-editor-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // CDN 응답은 opaque(no-cors)라 addAll을 쓸 수 없으므로 개별 저장. 실패해도 설치는 진행.
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        await cache.put(url, res);
      } catch (e) { /* 오프라인 설치 시 무시 */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('md-editor-') && k !== CACHE_NAME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = CDN_ASSETS.includes(req.url);
  if (!isSameOrigin && !isCdn) return;

  if (isCdn) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      try {
        const res = await fetch(req.url, { mode: 'no-cors' });
        cache.put(req.url, res.clone());
        return res;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // 같은 출처: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const fresh = await network;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('오프라인 상태이며 해당 리소스가 캐시되어 있지 않습니다.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
