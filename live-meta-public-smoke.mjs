const pagePluginUrl = 'https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2FNASA%2F&tabs=timeline&width=500&height=800&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false';

const targets = [
  'https://www.facebook.com/NASA/',
  'https://m.facebook.com/NASA/',
  'https://www.facebook.com/NASA/posts',
  pagePluginUrl,
  'https://www.instagram.com/nasa/'
];

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

function matchCount(html, regex) {
  return [...html.matchAll(regex)].length;
}

function extractTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (og || title || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function inspect(html, finalUrl, status) {
  const lower = html.toLowerCase();
  const loginWall = /\/login\//i.test(finalUrl) ||
    lower.includes('log in to facebook') ||
    lower.includes('not logged in') ||
    lower.includes('temporarily blocked') ||
    lower.includes('create new account');

  const facebookPostCandidates = matchCount(
    html,
    /(?:https?:\\?\/\\?\/(?:www\.|m\.)?facebook\.com)?(?:\\?\/|\/)(?:[^\s"'<>]+\\?\/)?(?:posts|permalink|reel|reels|videos)\\?\/[^\s"'<>]+|(?:photo|story)\.php\?[^\s"'<>]*(?:fbid|story_fbid)=/gi
  );
  const instagramPostCandidates = matchCount(
    html,
    /(?:https?:\\?\/\\?\/(?:www\.)?instagram\.com)?(?:\\?\/|\/)(?:p|reel)\\?\/[A-Za-z0-9_-]+/gi
  );

  return {
    status,
    finalUrl,
    title: extractTitle(html),
    loginWall,
    ogTitle: /property=["']og:title["']/i.test(html),
    ogImage: /property=["']og:image["']/i.test(html),
    facebookPostCandidates,
    instagramPostCandidates,
    htmlBytes: Buffer.byteLength(html)
  };
}

const results = [];
for (const target of targets) {
  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.8'
      }
    });
    const html = await response.text();
    results.push({ target, ok: true, ...inspect(html, response.url, response.status) });
  } catch (error) {
    results.push({ target, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log('=== MR SCRAP LIVE PUBLIC META SMOKE ===');
for (const result of results) console.log(JSON.stringify(result));

const visibleFeed = results.some(result => result.ok && !result.loginWall && ((result.facebookPostCandidates || 0) > 0 || (result.instagramPostCandidates || 0) > 0));
const metadataOnly = results.some(result => result.ok && !result.loginWall && (result.ogTitle || result.ogImage));

if (visibleFeed) {
  console.log('VERDICT=PUBLIC_META_FEED_VISIBLE');
} else if (metadataOnly) {
  console.log('VERDICT=PUBLIC_META_METADATA_ONLY');
} else {
  console.log('VERDICT=PUBLIC_META_BLOCKED_OR_LOGIN_WALLED');
}

// Diagnostic only. Public anonymous access is not the Android authenticated-session acceptance gate.
process.exit(0);
