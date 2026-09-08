import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const TEST_URL = 'https://www.facebook.com/StoneMountain64/videos/1062741033206907/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const targets = await (await fetch(`${BASE}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && (() => {
  try {
    const h = new URL(t.url).hostname.toLowerCase();
    return h === 'facebook.com' || h.endsWith('.facebook.com');
  } catch {
    return false;
  }
})());
if (!target?.webSocketDebuggerUrl) throw new Error('NO_FACEBOOK_TAB');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 5000);
  ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (!message.id || !pending.has(message.id)) return;
  const item = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) item.reject(new Error(message.error.message || 'CDP command failed'));
  else item.resolve(message.result);
});

function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('DOM evaluation exception');
  return result.result?.value;
}

try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: TEST_URL });
  await sleep(3500);

  const script = fs.readFileSync('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js', 'utf8');
  if (await evaluate(script) !== true) throw new Error('Shared extractor did not initialize');

  for (let i = 0; i < 4; i++) {
    await evaluate('globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__()');
    await sleep(900);
  }

  const raw = await evaluate(`globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(${JSON.stringify({
    commentsMode: 'top',
    commentLimit: 20,
    includeReplies: true,
    publisherName: 'StoneMountain64'
  })})`);
  const detail = JSON.parse(raw);
  if (detail.error) throw new Error(detail.error);

  const comments = Array.isArray(detail.comments) ? detail.comments : [];
  const publisherComments = comments.filter(comment => comment?.isPublisher === true).length;
  const mediaCount = Array.isArray(detail.media) ? detail.media.length : 0;
  console.log(JSON.stringify({
    comments: comments.length,
    publisherComments,
    mediaCount,
    videoPresent: detail.videoPresent === true,
    commentsTruncated: detail.commentsTruncated === true,
    commentArticles: Number(detail.diagnostics?.commentArticles || 0)
  }));

  if (comments.length < 5) throw new Error(`Expected at least 5 real comments, got ${comments.length}`);
  if (publisherComments < 1) throw new Error('Publisher comment identification failed');
  if (detail.videoPresent !== true) throw new Error('Known video post was not recognized as video');
  console.log('LIVE_COMMENT_PARITY_OK');
} finally {
  ws.close();
}
