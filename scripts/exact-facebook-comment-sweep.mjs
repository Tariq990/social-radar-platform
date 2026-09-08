import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const TARGET_URL = 'https://www.facebook.com/tarik.ziad.3914';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function isFacebookUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'facebook.com' || h.endsWith('.facebook.com');
  } catch { return false; }
}

function collectorScript(requestedUrl, limit = 10) {
  const java = fs.readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java', 'utf8');
  const method = java.indexOf('private static String extractionScript(');
  const blockStart = java.indexOf('return """', method);
  const scriptStart = java.indexOf('\n', blockStart) + 1;
  const blockEnd = java.indexOf('\n            """', scriptStart);
  return java.slice(scriptStart, blockEnd)
    .replace('__LIMIT__', String(limit))
    .replace('__REQUESTED__', JSON.stringify(requestedUrl));
}

const detailExtractor = fs.readFileSync('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js', 'utf8');
const targets = await (await fetch(`${BASE}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && isFacebookUrl(t.url));
if (!target?.webSocketDebuggerUrl) throw new Error('NO_FACEBOOK_CDP_TAB');
const originalUrl = target.url;
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP_OPEN_TIMEOUT')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => reject(new Error('CDP_SOCKET_ERROR')), { once: true });
});
let id = 1;
const pending = new Map();
socket.addEventListener('message', e => {
  let m; try { m = JSON.parse(e.data); } catch { return; }
  if (!m.id || !pending.has(m.id)) return;
  const p = pending.get(m.id); pending.delete(m.id);
  m.error ? p.reject(new Error(m.error.message || 'CDP_FAILED')) : p.resolve(m.result);
});
const cdp = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
  const callId = id++;
  const timer = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP_TIMEOUT:${method}`)); }, timeout);
  pending.set(callId, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id: callId, method, params }));
});
async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('EVAL_EXCEPTION');
  return r.result?.value;
}
async function ready(extra = 900) {
  for (let i = 0; i < 30; i++) {
    const s = await evalJs('document.readyState');
    if (s === 'complete' || s === 'interactive') { await sleep(extra); return; }
    await sleep(250);
  }
  throw new Error('READY_TIMEOUT');
}
await cdp('Runtime.enable'); await cdp('Page.enable');
const originalNavigator = await evalJs(`({ua:navigator.userAgent,platform:navigator.platform})`);
await cdp('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.7977.82 Mobile Safari/537.36',
  platform: 'Android'
});
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });

const summary = { posts: 0, checked: 0, postsWithComments: 0, totalCommentsSample: 0, totalPublisherComments: 0, totalReplies: 0, postsWithVideo: 0, totalPostMediaItems: 0, maxCommentArticles: 0, details: [] };
try {
  await cdp('Page.navigate', { url: TARGET_URL }); await ready(1300);
  const extraction = collectorScript(TARGET_URL, 10);
  let best = { posts: [] };
  for (let i = 0; i < 12; i++) {
    const raw = await evalJs(extraction);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((parsed?.posts?.length || 0) > (best?.posts?.length || 0)) best = parsed;
    if ((best?.posts?.length || 0) >= 10) break;
    await evalJs(`window.scrollBy(0, Math.round(Math.max(innerHeight||700,700)*1.8))`); await sleep(900);
  }
  const posts = Array.isArray(best?.posts) ? best.posts : [];
  summary.posts = posts.length;
  for (const post of posts.slice(0, 10)) {
    if (!post?.originalUrl || !isFacebookUrl(post.originalUrl)) continue;
    await cdp('Page.navigate', { url: post.originalUrl }); await ready(850);
    await evalJs(detailExtractor);
    for (let pass = 0; pass < 5; pass++) {
      await evalJs(`globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__()`);
      await sleep(450);
    }
    const opts = { commentsMode: 'all', commentLimit: 50, includeReplies: true, publisherName: String(post.authorName || '') };
    const allRaw = await evalJs(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify(opts)})`);
    const all = typeof allRaw === 'string' ? JSON.parse(allRaw) : allRaw;
    const pubRaw = await evalJs(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({ ...opts, commentsMode: 'publisher', commentLimit: 20 })})`);
    const pub = typeof pubRaw === 'string' ? JSON.parse(pubRaw) : pubRaw;
    const comments = Array.isArray(all?.comments) ? all.comments : [];
    const media = Array.isArray(all?.media) ? all.media : [];
    const articleCount = Number(all?.diagnostics?.commentArticles || 0);
    const detail = {
      comments: comments.length,
      publisherComments: Array.isArray(pub?.comments) ? pub.comments.length : 0,
      replies: comments.filter(c => Number(c?.depth || 0) > 0).length,
      commentArticles: articleCount,
      mediaItems: media.length,
      videoPresent: Boolean(all?.videoPresent),
      hasMoreControls: Boolean(all?.diagnostics?.hasMoreControls)
    };
    summary.details.push(detail);
    summary.checked++;
    if (comments.length > 0 || articleCount > 0) summary.postsWithComments++;
    summary.totalCommentsSample += comments.length;
    summary.totalPublisherComments += detail.publisherComments;
    summary.totalReplies += detail.replies;
    if (detail.videoPresent) summary.postsWithVideo++;
    summary.totalPostMediaItems += media.length;
    summary.maxCommentArticles = Math.max(summary.maxCommentArticles, articleCount);
  }
} finally {
  try { await cdp('Emulation.clearDeviceMetricsOverride'); } catch {}
  try { if (originalNavigator?.ua) await cdp('Emulation.setUserAgentOverride', { userAgent: originalNavigator.ua, platform: originalNavigator.platform || 'Linux x86_64' }); } catch {}
  try { await cdp('Page.navigate', { url: originalUrl }); } catch {}
  socket.close();
}
console.log('EXACT_FACEBOOK_COMMENT_SWEEP');
console.log(JSON.stringify(summary, null, 2));
if (summary.posts === 0) process.exit(4);
console.log('EXACT_FACEBOOK_COMMENT_SWEEP_COMPLETE');
