import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const TARGET = 'https://www.facebook.com/tarik.ziad.3914';
const POST_LIMIT = 10;
const COMMENT_LIMIT = 50;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isFacebookUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'facebook.com' || h.endsWith('.facebook.com');
  } catch { return false; }
}

function isPhotoPost(raw) {
  try {
    const u = new URL(raw);
    const p = u.pathname.toLowerCase();
    return p === '/photo' || p === '/photo/' || p === '/photo.php' || p.startsWith('/photo/');
  } catch { return false; }
}

function extractCollectorScript(requestedUrl, limit) {
  const java = fs.readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java', 'utf8');
  const method = java.indexOf('private static String extractionScript(');
  const blockStart = java.indexOf('return """', method);
  const scriptStart = java.indexOf('\n', blockStart) + 1;
  const blockEnd = java.indexOf('\n            """', scriptStart);
  if (method < 0 || blockStart < 0 || blockEnd < 0) throw new Error('COLLECTOR_SCRIPT_NOT_FOUND');
  return java.slice(scriptStart, blockEnd)
    .replace('__LIMIT__', String(limit))
    .replace('__REQUESTED__', JSON.stringify(requestedUrl));
}

function photoIdentity(raw) {
  try {
    const u = new URL(raw);
    return {
      fbid: u.searchParams.get('fbid') || '',
      normalized: u.href
    };
  } catch {
    return { fbid: '', normalized: raw };
  }
}

const detailExtractor = fs.readFileSync('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js', 'utf8');
if (!detailExtractor.includes('facebookPhotoListComments')) throw new Error('PHOTO_LISTITEM_FIX_NOT_APPLIED');
if (!detailExtractor.includes('[role="listitem"]')) throw new Error('PHOTO_LISTITEM_SELECTOR_MISSING');

const targetsResponse = await fetch(`${BASE}/json/list`);
if (!targetsResponse.ok) throw new Error(`CDP_LIST_HTTP_${targetsResponse.status}`);
const targets = await targetsResponse.json();
const tab = targets.find(t => t.type === 'page' && isFacebookUrl(t.url));
if (!tab?.webSocketDebuggerUrl) throw new Error('NO_AUTHENTICATED_FACEBOOK_TAB');

const originalUrl = tab.url;
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP_OPEN_TIMEOUT')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_SOCKET_ERROR')); }, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message || 'CDP_COMMAND_FAILED'));
  else entry.resolve(message.result);
});

function cdp(method, params = {}, timeoutMs = 15000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP_TIMEOUT_${method}`));
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
  if (result.exceptionDetails) throw new Error('DOM_EVALUATION_EXCEPTION');
  return result.result?.value;
}

async function waitReady(extraMs = 1000) {
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
const originalNavigator = await evaluate(`({ua:navigator.userAgent,platform:navigator.platform})`);
const webViewUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.7977.82 Mobile Safari/537.36';

const summary = {
  sourceResolved: false,
  loadedSurface: '',
  posts: 0,
  photoPostFound: false,
  photoClicked: false,
  listItems: 0,
  extractedComments: 0,
  publisherComments: 0,
  topComments: 0,
  replies: 0,
  commentMediaItems: 0,
  postMediaItems: 0,
  videoPresent: false,
  hasMoreControls: false
};

try {
  await cdp('Emulation.setUserAgentOverride', { userAgent: webViewUA, platform: 'Android' });
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    screenWidth: 412,
    screenHeight: 915
  });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await cdp('Page.navigate', { url: TARGET });
  await waitReady(1400);

  const collector = extractCollectorScript(TARGET, POST_LIMIT);
  let best = { posts: [], diagnostics: {}, source: null };
  for (let attempt = 0; attempt < 14; attempt++) {
    const raw = await evaluate(collector);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((parsed?.posts?.length || 0) > (best?.posts?.length || 0)) best = parsed;
    if ((best?.posts?.length || 0) >= POST_LIMIT) break;
    await evaluate(`(() => { const h=Math.max(innerHeight||700,700); window.scrollBy(0,Math.round(h*1.8)); return scrollY; })()`);
    await sleep(850);
  }

  const posts = Array.isArray(best.posts) ? best.posts : [];
  summary.sourceResolved = Boolean(best?.source?.externalId && best?.source?.displayName);
  summary.loadedSurface = String(best?.diagnostics?.surface || await evaluate('location.hostname'));
  summary.posts = posts.length;

  if (!summary.sourceResolved) throw new Error('EXACT_SOURCE_METADATA_NOT_RESOLVED');
  if (posts.length < POST_LIMIT) throw new Error(`EXACT_SOURCE_ONLY_${posts.length}_POSTS`);

  const photo = posts.find(post => post?.originalUrl && isPhotoPost(post.originalUrl));
  if (!photo) throw new Error('NO_PHOTO_POST_IN_EXACT_SOURCE_SAMPLE');
  summary.photoPostFound = true;

  // Mirror the modified Android detail collector: stay on source, locate the exact photo link,
  // click it so Facebook opens the authenticated photo viewer, then run the exact raw extractor.
  const identity = photoIdentity(photo.originalUrl);
  await cdp('Page.navigate', { url: TARGET });
  await waitReady(1000);

  for (let attempt = 0; attempt < 14; attempt++) {
    const clicked = await evaluate(`(() => {
      const fbid=${JSON.stringify(identity.fbid)};
      const target=${JSON.stringify(identity.normalized)};
      const anchors=[...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];
      const match=anchors.find(a=>{
        const raw=a.getAttribute('href')||a.getAttribute('data-href')||a.getAttribute('data-url')||a.getAttribute('ajaxify')||'';
        let u; try { u=new URL(raw,location.href); } catch { return false; }
        if (fbid && u.searchParams.get('fbid')===fbid) return true;
        return u.href===target;
      });
      if (!match) return false;
      match.click();
      return true;
    })()`);
    if (clicked) {
      summary.photoClicked = true;
      break;
    }
    await evaluate(`(() => { const h=Math.max(innerHeight||700,700); window.scrollBy(0,Math.round(h*1.7)); return scrollY; })()`);
    await sleep(700);
  }
  if (!summary.photoClicked) throw new Error('PHOTO_POST_CLICK_FAILED_ON_EXACT_SOURCE');

  await sleep(2300);
  await evaluate(detailExtractor);

  for (let pass = 0; pass < 8; pass++) {
    await evaluate(`globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__()`);
    await sleep(500);
  }

  summary.listItems = Number(await evaluate(`document.querySelectorAll('[role="dialog"] [role="listitem"]').length`));

  const publisherName = String(photo.authorName || '');
  const allRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({
    commentsMode: 'all', commentLimit: COMMENT_LIMIT, includeReplies: true, publisherName
  })})`);
  const publisherRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({
    commentsMode: 'publisher', commentLimit: 20, includeReplies: true, publisherName
  })})`);
  const topRaw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({
    commentsMode: 'top', commentLimit: 20, includeReplies: true, publisherName
  })})`);

  const all = typeof allRaw === 'string' ? JSON.parse(allRaw) : allRaw;
  const publisher = typeof publisherRaw === 'string' ? JSON.parse(publisherRaw) : publisherRaw;
  const top = typeof topRaw === 'string' ? JSON.parse(topRaw) : topRaw;
  const comments = Array.isArray(all?.comments) ? all.comments : [];
  const media = Array.isArray(all?.media) ? all.media : [];

  summary.extractedComments = comments.length;
  summary.publisherComments = Array.isArray(publisher?.comments) ? publisher.comments.length : 0;
  summary.topComments = Array.isArray(top?.comments) ? top.comments.length : 0;
  summary.replies = comments.filter(comment => Number(comment?.depth || 0) > 0).length;
  summary.commentMediaItems = comments.reduce((sum, comment) => sum + (Array.isArray(comment?.media) ? comment.media.length : 0), 0);
  summary.postMediaItems = media.length;
  summary.videoPresent = Boolean(all?.videoPresent);
  summary.hasMoreControls = Boolean(all?.diagnostics?.hasMoreControls);

  if (summary.listItems <= 0) throw new Error('PHOTO_VIEWER_HAS_NO_LISTITEMS');
  if (summary.extractedComments <= 0) throw new Error('PHOTO_LISTITEM_EXTRACTOR_RETURNED_ZERO_COMMENTS');
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
  try { if (originalUrl) await cdp('Page.navigate', { url: originalUrl }); } catch {}
  socket.close();
}

console.log('FACEBOOK_PHOTO_COMMENT_FIX_VALIDATION');
console.log(JSON.stringify(summary, null, 2));
console.log('FACEBOOK_EXACT_SOURCE_POSTS_AND_COMMENTS_FOUND');
