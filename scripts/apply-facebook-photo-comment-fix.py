from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)

# TypeScript native contract + call.
path = Path('src/connectors/deviceSessionConnector.ts')
text = path.read_text()
text = replace_once(text,
"""  collectPostDetails(options: {\n    url: string;\n    platform: string;""",
"""  collectPostDetails(options: {\n    url: string;\n    sourceUrl: string;\n    platform: string;""",
'connector contract')
text = replace_once(text,
"""        const detail = await NativeSession.collectPostDetails({\n          url: post.originalUrl,\n          platform: source.platform,""",
"""        const detail = await NativeSession.collectPostDetails({\n          url: post.originalUrl,\n          sourceUrl: source.url,\n          platform: source.platform,""",
'connector detail call')
path.write_text(text)

# Native plugin passes the source URL only as normalized navigation context.
path = Path('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java')
text = path.read_text()
text = replace_once(text,
"""    public void collectPostDetails(PluginCall call) {\n        String url = call.getString(\"url\");\n        String publisherName = call.getString(\"publisherName\", \"\");""",
"""    public void collectPostDetails(PluginCall call) {\n        String url = call.getString(\"url\");\n        String sourceUrl = call.getString(\"sourceUrl\", \"\");\n        String publisherName = call.getString(\"publisherName\", \"\");""",
'plugin source url')
text = replace_once(text,
"""        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {\n            call.reject(\"Invalid Facebook/Instagram post URL\");\n            return;\n        }\n        String platform = SessionStateStore.platformForUrl(url);""",
"""        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {\n            call.reject(\"Invalid Facebook/Instagram post URL\");\n            return;\n        }\n        if (sourceUrl != null && !sourceUrl.isBlank() && !AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl)) {\n            call.reject(\"Invalid Facebook/Instagram source URL\");\n            return;\n        }\n        String platform = SessionStateStore.platformForUrl(url);\n        if (sourceUrl != null && !sourceUrl.isBlank() &&\n            !platform.equalsIgnoreCase(SessionStateStore.platformForUrl(sourceUrl))) {\n            call.reject(\"Post and source platforms do not match\");\n            return;\n        }""",
'plugin validation')
text = replace_once(text,
"""            foregroundContext(),\n            url,\n            publisherName,""",
"""            foregroundContext(),\n            url,\n            sourceUrl,\n            publisherName,""",
'plugin collector call')
path.write_text(text)

# Detail collector: photo links are opened from the source feed so Facebook renders the full viewer.
path = Path('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java')
text = path.read_text()
text = replace_once(text,
"""        Context context,\n        String url,\n        String publisherName,""",
"""        Context context,\n        String url,\n        String sourceUrl,\n        String publisherName,""",
'collector signature')
text = replace_once(text,
"""        final int maxAttempts = \"all\".equals(mode) ? MAX_ALL_ATTEMPTS : MAX_STANDARD_ATTEMPTS;\n        final String targetUrl = preferDesktopFacebookUrl(url);""",
"""        final int maxAttempts = \"all\".equals(mode) ? MAX_ALL_ATTEMPTS : MAX_STANDARD_ATTEMPTS;\n        final boolean photoDetailMode = isFacebookPhotoUrl(url) && sourceUrl != null &&\n            !sourceUrl.isBlank() && AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl);\n        final String targetUrl = preferDesktopFacebookUrl(photoDetailMode ? sourceUrl : url);""",
'collector target mode')
text = replace_once(text,
"""            int[] attempts = new int[] { 0 };\n            int[] lastCommentCount = new int[] { -1 };""",
"""            int[] attempts = new int[] { 0 };\n            boolean[] photoOpened = new boolean[] { !photoDetailMode };\n            int[] lastCommentCount = new int[] { -1 };""",
'collector photo state')
text = replace_once(text,
"""                if (finished.get()) return;\n                attempts[0]++;\n\n                webView.evaluateJavascript(extractorScript, loaded -> {""",
"""                if (finished.get()) return;\n                attempts[0]++;\n\n                if (photoDetailMode && !photoOpened[0]) {\n                    webView.evaluateJavascript(photoClickScript(url), clickedValue -> {\n                        if (finished.get()) return;\n                        boolean clicked = \"true\".equalsIgnoreCase(String.valueOf(clickedValue));\n                        if (clicked) {\n                            photoOpened[0] = true;\n                            attempts[0] = 0;\n                            main.postDelayed(runner[0], 850);\n                            return;\n                        }\n                        if (attempts[0] < maxAttempts) {\n                            webView.evaluateJavascript(\n                                \"(() => { const h=Math.max(window.innerHeight||700,700); window.scrollBy(0,Math.round(h*1.7)); return window.scrollY; })()\",\n                                ignored -> main.postDelayed(runner[0], RETRY_DELAY_MS)\n                            );\n                            return;\n                        }\n                        finishError(main, timeout, webView, finished, callback, \"PHOTO_POST_NOT_FOUND_ON_SOURCE\");\n                    });\n                    return;\n                }\n\n                webView.evaluateJavascript(extractorScript, loaded -> {""",
'collector photo click runner')
insert_before = """    private static String normalizeMode(String value) {"""
helpers = r'''    private static boolean isFacebookPhotoUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            String path = uri.getPath();
            if (host == null || path == null) return false;
            String normalized = host.toLowerCase();
            boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com");
            if (!facebook) return false;
            String p = path.toLowerCase();
            return p.equals("/photo") || p.equals("/photo/") || p.equals("/photo.php") || p.startsWith("/photo/");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String photoClickScript(String rawUrl) {
        String target = JSONObject.quote(rawUrl);
        return "(() => {" +
            "const target=" + target + ";" +
            "let wanted;try{wanted=new URL(target,location.href);}catch(e){return false;}" +
            "const fbid=wanted.searchParams.get('fbid')||'';" +
            "const anchors=[...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];" +
            "const match=anchors.find(a=>{const raw=a.getAttribute('href')||a.getAttribute('data-href')||a.getAttribute('data-url')||a.getAttribute('ajaxify')||'';let u;try{u=new URL(raw,location.href);}catch(e){return false;}if(fbid&&u.searchParams.get('fbid')===fbid)return true;return u.href===wanted.href;});" +
            "if(!match)return false;match.click();return true;" +
            "})()";
    }

'''
text = replace_once(text, insert_before, helpers + insert_before, 'collector helpers')
path.write_text(text)

# JS extractor fallback for Facebook photo viewer role=list/listitem comments.
path = Path('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js')
text = path.read_text()
text = replace_once(text,
"""  const commentNodes = () => {\n    const facebook = [...document.querySelectorAll('[role=\"article\"][aria-label]')].filter(isFacebookCommentArticle);\n    if (facebook.length || platform() === 'facebook') return facebook;\n    return instagramCommentCandidates();\n  };""",
"""  const facebookPhotoListComments = () => [...document.querySelectorAll('[role=\"dialog\"] [role=\"listitem\"]')].filter(node => {\n    const text = (node.innerText || '').trim();\n    if (text.length < 3 || text.length > 12000) return false;\n    const profileLink = [...node.querySelectorAll('a[href]')].some(anchor => {\n      try {\n        const u = new URL(anchor.href, location.href);\n        const h = u.hostname.toLowerCase();\n        const parts = u.pathname.split('/').filter(Boolean);\n        return (h === 'facebook.com' || h.endsWith('.facebook.com')) &&\n          (parts.length === 1 || u.pathname.toLowerCase() === '/profile.php');\n      } catch { return false; }\n    });\n    return profileLink;\n  });\n\n  const commentNodes = () => {\n    const facebook = [...document.querySelectorAll('[role=\"article\"][aria-label]')].filter(isFacebookCommentArticle);\n    if (facebook.length) return facebook;\n    if (platform() === 'facebook') return facebookPhotoListComments();\n    return instagramCommentCandidates();\n  };""",
'extractor comment nodes')
text = replace_once(text,
"""  const commentDepth = node => {\n    let depth = 0;\n    let parent = node?.parentElement || null;\n    while (parent && depth < 4) {\n      if (isFacebookCommentArticle(parent)) depth++;\n      parent = parent.parentElement;\n    }\n    return depth;\n  };""",
"""  const commentDepth = node => {\n    let depth = 0;\n    let parent = node?.parentElement || null;\n    const listItemMode = Boolean(node?.matches?.('[role=\"listitem\"]'));\n    while (parent && depth < 4) {\n      if (isFacebookCommentArticle(parent) || (listItemMode && parent.matches?.('[role=\"listitem\"]'))) depth++;\n      parent = parent.parentElement;\n    }\n    return depth;\n  };\n\n  const facebookListItemAuthor = (node, anchor) => {\n    if (!node?.matches?.('[role=\"listitem\"]')) return '';\n    const root = anchor || node;\n    const leaves = [...root.querySelectorAll('div,span')].filter(item => {\n      const value = (item.innerText || '').replace(/\\s+/g, ' ').trim();\n      return value && value.length <= 255 && !item.querySelector('*') && !actionLine(value);\n    });\n    const preferred = leaves.find(item => item.tagName === 'DIV') || leaves[0];\n    return (preferred?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 255);\n  };""",
'extractor depth and author')
text = replace_once(text,
"""    for (const nested of [...clone.querySelectorAll('[role=\"article\"][aria-label]')]) {\n      if (isFacebookCommentArticle(nested)) nested.remove();\n    }""",
"""    for (const nested of [...clone.querySelectorAll('[role=\"article\"][aria-label]')]) {\n      if (isFacebookCommentArticle(nested)) nested.remove();\n    }\n    if (node.matches?.('[role=\"listitem\"]')) {\n      for (const nested of [...clone.querySelectorAll('[role=\"listitem\"]')]) nested.remove();\n    }""",
'extractor nested listitems')
text = replace_once(text,
"""        const authorName = ((authorAnchor?.innerText || authorAnchor?.getAttribute?.('aria-label') || '').trim() || parseAuthorFromLabel(label)).slice(0, 255);""",
"""        const authorName = (facebookListItemAuthor(node, authorAnchor) ||\n          (authorAnchor?.innerText || authorAnchor?.getAttribute?.('aria-label') || '').trim() ||\n          parseAuthorFromLabel(label)).slice(0, 255);""",
'extractor author assignment')
path.write_text(text)

# Architecture regression locks the photo-viewer contract.
path = Path('server/tests/architectureRegression.test.ts')
text = path.read_text()
needle = """test('Smart Grab surfaces sanitized native collection diagnostics instead of discarding them', () => {"""
new_test = r'''test('Facebook photo Smart Grab opens detail from its source and supports listitem comments', () => {
  const connector = read('src/connectors/deviceSessionConnector.ts');
  const plugin = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java');
  const collector = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java');
  const extractor = read('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js');
  assert.match(connector, /sourceUrl: source\.url/);
  assert.match(plugin, /String sourceUrl = call\.getString\("sourceUrl"/);
  assert.match(collector, /isFacebookPhotoUrl/);
  assert.match(collector, /photoClickScript/);
  assert.match(collector, /PHOTO_POST_NOT_FOUND_ON_SOURCE/);
  assert.match(extractor, /facebookPhotoListComments/);
  assert.match(extractor, /role=\\"listitem\\"/);
  assert.match(extractor, /facebookListItemAuthor/);
  assert.doesNotMatch(collector, /getCookie\(|document\.cookie|CookieManager.*getCookie/);
});

'''
text = replace_once(text, needle, new_test + needle, 'regression insertion')
path.write_text(text)

print('Facebook photo comment production patch applied.')
