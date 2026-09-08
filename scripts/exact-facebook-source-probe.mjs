import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const TARGET_URL = process.env.META_TARGET_URL || 'https://www.facebook.com/tarik.ziad.3914';
const POST_LIMIT = 10;
const DETAIL_POSTS = 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isFacebookUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'facebook.com' || h.endsWith('.facebook.com');
  } catch { return false; }
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

const detailExtractor = fs.readFileSync('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js', 'utf8');
const targetsResponse = await fetch(`${BASE}/json/list`);
if (!targetsResponse.ok) throw new Error(`CDP target listing failed: HTTP ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const pages = targets.filter(t => t.type === 'page' && typeof t.url === 'string');
const target = pages.find(t => isFacebookUrl(t.url)) || pages.find(t => t.webSocketDebuggerUrl);
if (!target?.webSocketDebuggerUrl) throw new Error('NO_DEBUGGABLE_TAB');

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

function cdp(method, params = {}, timeoutMs = 15000) {
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
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('DOM evaluation raised an exception');
  return result.result?.value;
}

async function waitReady(extraMs = 1100) {
  for (let i = 0; i < 40; i++) {
    const state = await evaluate('document.readyState');
    if (state === 'complete' || state === 'interactive') {
      await sleep(extraMs);
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
await cdp('Emulation.setUserAgentOverride', { userAgent: webViewUA, platform: 'Android' });
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915
});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const summary = {
  requestedPath: new URL(TARGET_URL).pathname,
  sourceResolved: false,
  loadedSurface: '',
  posts: 0,
  postLinks: 0,
  containers: 0,
  anchors: 0,
  detailPostsChecked: 0,
  detail: []
};

try {
  await cdp('Page.navigate', { url: TARGET_URL }, 15000);
  await waitReady(1500);
  const extractor = extractCollectorScript(TARGET_URL, POST_LIMIT);
  let best = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    let parsed;
    try {
      const raw = await evaluate(extractor);
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsed = { error: 'EVALUATION_OR_PARSE_FAILED', posts: [] };
    }
    if (!best || (parsed?.posts?.length || 0) > (best?.posts?.length || 0)) best = parsed;
    if ((parsed?.posts?.length || 0) >= POST_LIMIT) break;
    await evaluate(`(() => { const h=Math.max(window.innerHeight||700,700); window.scrollBy(0,Math.round(h*1.8)); return window.scrollY; })()`);
    await sleep(1100);
  }

  const diagnostics = best?.diagnostics || {};
  const posts = Array.isArray(best?.posts) ? best.posts : [];
  summary.sourceResolved = Boolean(best?.source?.externalId && best?.source?.displayName);
  summary.loadedSurface = String(diagnostics.surface || await evaluate('location.hostname'));
  summary.posts = posts.length;
  summary.postLinks = Number(diagnostics.postLinks || 0);
  summary.containers = Number(diagnostics.containers || 0);
  summary.anchors = Number(diagnostics.anchors || 0);

  if (!summary.sourceResolved || posts.length === 0) throw new Error('EXACT_SOURCE_NO_POSTS');

  for (const post of posts.slice(0, DETAIL_POSTS)) {
    const postUrl = post?.originalUrl;
    if (!postUrl || !isFacebookUrl(postUrl)) continue;
    await cdp('Page.navigate', { url: postUrl }, 15000);
    await waitReady(1200);
    await evaluate(detailExtractor);

    for (let i = 0; i < 6; i++) {
      await evaluate(`globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__()`);
      await sleep(650);
    }

    const publisherName = String(post?.authorName || '');
    const topRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({ commentsMode: 'top', commentLimit: 20, includeReplies: true, publisherName })})`);
    const pubRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({ commentsMode: 'publisher', commentLimit: 20, includeReplies: true, publisherName })})`);
    const allRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({ commentsMode: 'all', commentLimit: 50, includeReplies: true, publisherName })})`);
    const top = typeof topRaw === 'string' ? JSON.parse(topRaw) : topRaw;
    const pub = typeof pubRaw === 'string' ? JSON.parse(pubRaw) : pubRaw;
    const all = typeof allRaw === 'string' ? JSON.parse(allRaw) : allRaw;
    const comments = Array.isArray(all?.comments) ? all.comments : [];
    const media = Array.isArray(all?.media) ? all.media : [];
    summary.detail.push({
      topComments: Array.isArray(top?.comments) ? top.comments.length : 0,
      publisherComments: Array.isArray(pub?.comments) ? pub.comments.length : 0,
      allAccessibleCommentsSample: comments.length,
      replies: comments.filter(c => Number(c?.depth || 0) > 0).length,
      commentMediaItems: comments.reduce((n, c) => n + (Array.isArray(c?.media) ? c.media.length : 0), 0),
      postMediaItems: media.length,
      postImages: media.filter(m => m?.type === 'image').length,
      postVideosWithHttpSrc: media.filter(m => m?.type === 'video').length,
      videoPresent: Boolean(all?.videoPresent),
      commentArticles: Number(all?.diagnostics?.commentArticles || 0),
      hasMoreControls: Boolean(all?.diagnostics?.hasMoreControls),
      commentsTruncated: Boolean(all?.commentsTruncated)
    });
  }
  summary.detailPostsChecked = summary.detail.length;
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
  try { if (originalUrl) await cdp('Page.navigate', { url: originalUrl }, 15000); } catch {}
  socket.close();
}

console.log('EXACT_FACEBOOK_SOURCE_PROBE');
console.log(JSON.stringify(summary, null, 2));
if (!summary.sourceResolved || summary.posts === 0) process.exit(4);
console.log('EXACT_FACEBOOK_SOURCE_SMART_GRAB_FOUND_REAL_POSTS');
