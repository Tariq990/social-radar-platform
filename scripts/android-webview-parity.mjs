import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isFacebookUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'facebook.com' || h.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

function sameFacebookPath(raw, host) {
  const u = new URL(raw);
  u.protocol = 'https:';
  u.hostname = host;
  u.port = '';
  u.hash = '';
  return u.toString();
}

function extractCollectorScript(requestedUrl, limit = 10) {
  const java = fs.readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java', 'utf8');
  const method = java.indexOf('private static String extractionScript(');
  if (method < 0) throw new Error('EXTRACTION_METHOD_NOT_FOUND');
  const blockStart = java.indexOf('return """', method);
  if (blockStart < 0) throw new Error('EXTRACTION_TEXT_BLOCK_NOT_FOUND');
  const scriptStart = java.indexOf('\n', blockStart) + 1;
  const blockEnd = java.indexOf('\n            """', scriptStart);
  if (blockEnd < 0) throw new Error('EXTRACTION_TEXT_BLOCK_END_NOT_FOUND');
  return java.slice(scriptStart, blockEnd)
    .replace('__LIMIT__', String(limit))
    .replace('__REQUESTED__', JSON.stringify(requestedUrl));
}

const targetsResponse = await fetch(`${BASE}/json/list`);
if (!targetsResponse.ok) throw new Error(`CDP target listing failed: HTTP ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const pages = targets.filter(t => t.type === 'page' && typeof t.url === 'string' && isFacebookUrl(t.url));
if (!pages.length) {
  console.error('NO_FACEBOOK_TAB');
  process.exit(2);
}

const target = pages.find(t => {
  try {
    const p = new URL(t.url).pathname.toLowerCase();
    return p !== '/' && !p.includes('/login') && !p.includes('/checkpoint');
  } catch {
    return false;
  }
}) || pages[0];
if (!target.webSocketDebuggerUrl) throw new Error('FACEBOOK_TARGET_HAS_NO_CDP_SOCKET');

const originalUrl = target.url;
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP websocket open timeout')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket error')); }, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed'));
  else entry.resolve(message.result);
});

function cdp(method, params = {}, timeoutMs = 10000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error('DOM evaluation raised an exception');
  return result.result?.value;
}

async function waitReady() {
  for (let i = 0; i < 30; i++) {
    const state = await evaluate('document.readyState');
    if (state === 'complete' || state === 'interactive') {
      await sleep(900);
      return;
    }
    await sleep(250);
  }
  throw new Error('PAGE_READY_TIMEOUT');
}

await cdp('Runtime.enable');
await cdp('Page.enable');
await cdp('Network.enable');

const originalNavigator = await evaluate(`({ua:navigator.userAgent, platform:navigator.platform})`);
const webViewUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.7977.82 Mobile Safari/537.36';

await cdp('Emulation.setUserAgentOverride', {
  userAgent: webViewUA,
  platform: 'Android'
});
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 412,
  height: 915,
  deviceScaleFactor: 2.625,
  mobile: true,
  screenWidth: 412,
  screenHeight: 915
});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const surfaces = ['www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com'];
const report = [];

try {
  for (const host of surfaces) {
    const requestedUrl = sameFacebookPath(originalUrl, host);
    await cdp('Page.navigate', { url: requestedUrl }, 15000);
    await waitReady();

    const attempts = [];
    const extractor = extractCollectorScript(originalUrl, 10);
    for (let i = 0; i < 5; i++) {
      let parsed;
      try {
        const raw = await evaluate(extractor);
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (error) {
        parsed = { error: 'EVALUATION_OR_PARSE_FAILED' };
      }
      const diagnostics = parsed?.diagnostics || {};
      attempts.push({
        attempt: i + 1,
        loadedSurface: String(diagnostics.surface || await evaluate('location.hostname')),
        error: String(parsed?.error || ''),
        sourceResolved: Boolean(parsed?.source?.externalId && parsed?.source?.displayName),
        posts: Array.isArray(parsed?.posts) ? parsed.posts.length : 0,
        containers: Number(diagnostics.containers || 0),
        anchors: Number(diagnostics.anchors || 0),
        postLinks: Number(diagnostics.postLinks || 0),
        bodyTextLength: Number(diagnostics.bodyTextLength || 0),
        readyState: String(diagnostics.readyState || '')
      });
      if ((Array.isArray(parsed?.posts) ? parsed.posts.length : 0) >= 10) break;
      await evaluate(`(() => { const h=Math.max(window.innerHeight||700,700); window.scrollBy(0,Math.round(h*1.7)); return window.scrollY; })()`);
      await sleep(1000);
    }
    report.push({ requestedSurface: host, attempts });
  }
} finally {
  try { await cdp('Emulation.clearDeviceMetricsOverride'); } catch {}
  try {
    if (originalNavigator?.ua) {
      await cdp('Emulation.setUserAgentOverride', {
        userAgent: originalNavigator.ua,
        platform: originalNavigator.platform || 'Linux x86_64'
      });
    }
  } catch {}
  try { await cdp('Page.navigate', { url: originalUrl }, 15000); } catch {}
  socket.close();
}

console.log('ANDROID_WEBVIEW_PARITY');
console.log(JSON.stringify(report, null, 2));

const bestPosts = Math.max(0, ...report.flatMap(surface => surface.attempts.map(a => Number(a.posts || 0))));
const bestPostLinks = Math.max(0, ...report.flatMap(surface => surface.attempts.map(a => Number(a.postLinks || 0))));
console.log(`BEST_EXTRACTED_POSTS=${bestPosts}`);
console.log(`BEST_POST_LINKS=${bestPostLinks}`);
if (bestPosts === 0) {
  console.error('ANDROID_WEBVIEW_PARITY_NO_POSTS');
  process.exit(4);
}
console.log('ANDROID_WEBVIEW_PARITY_POSTS_FOUND');
