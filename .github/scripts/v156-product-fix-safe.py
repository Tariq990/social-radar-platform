from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old!r}")
    p.write_text(text.replace(old, new, 1))


resolver = "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceMetadataResolver.java"
replace_once(resolver,
    "    private static final int MAX_EXTRACTION_ATTEMPTS = 20;\n    private static final int AVATAR_GRACE_ATTEMPTS = 12;",
    "    private static final int MAX_EXTRACTION_ATTEMPTS = 20;")
replace_once(resolver,
    '''                        boolean reliable = !result.has("error") && source != null &&\n                            AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);\n                        if (reliable && (!isBlank(avatarUrl) || attempts[0] >= AVATAR_GRACE_ATTEMPTS)) {''',
    '''                        boolean realDisplayName = hasRealDisplayName(displayName, externalId);\n                        boolean reliable = !result.has("error") && source != null &&\n                            AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) && realDisplayName && !isBlank(externalId);\n                        if (!realDisplayName && source != null && AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) &&\n                            !sameSocialLocation(currentUrl, sourceUrl) && attempts[0] < MAX_EXTRACTION_ATTEMPTS) {\n                            webView.loadUrl(preferDesktopFacebookUrl(sourceUrl));\n                            main.postDelayed(runner[0], 1_600);\n                            return;\n                        }\n                        if (reliable && !isBlank(avatarUrl)) {''')
replace_once(resolver,
    '''    private static boolean isBlank(String value) {\n        if (value == null) return true;\n        String normalized = value.trim().toLowerCase();\n        return normalized.isEmpty() || normalized.equals("blank") || normalized.equals("about:blank") || normalized.equals("null") || normalized.equals("undefined");\n    }\n\n    private static void destroy(WebView webView) {''',
    '''    private static boolean isBlank(String value) {\n        if (value == null) return true;\n        String normalized = value.trim().toLowerCase();\n        return normalized.isEmpty() || normalized.equals("blank") || normalized.equals("about:blank") || normalized.equals("null") || normalized.equals("undefined");\n    }\n\n    private static boolean hasRealDisplayName(String value, String externalId) {\n        if (isBlank(value)) return false;\n        String normalized = value.trim().replaceFirst("^@", "").toLowerCase();\n        String id = externalId == null ? "" : externalId.trim().replaceFirst("^@", "").toLowerCase();\n        return !normalized.equals(id) && !normalized.equals("facebook") && !normalized.equals("instagram") &&\n            !normalized.equals("page") && !normalized.equals("profile") &&\n            !normalized.equals("log into facebook") && !normalized.equals("log in to facebook");\n    }\n\n    private static boolean sameSocialLocation(String left, String right) {\n        try {\n            Uri a = Uri.parse(left == null ? "" : left);\n            Uri b = Uri.parse(right == null ? "" : right);\n            String ah = normalizeHost(a.getHost());\n            String bh = normalizeHost(b.getHost());\n            String ap = normalizePath(a.getPath());\n            String bp = normalizePath(b.getPath());\n            return !ah.isBlank() && ah.equals(bh) && ap.equals(bp);\n        } catch (Exception ignored) { return false; }\n    }\n\n    private static String normalizeHost(String value) {\n        if (value == null) return "";\n        return value.toLowerCase().replaceFirst("^(www\\\\.|m\\\\.|mobile\\\\.|web\\\\.)", "");\n    }\n\n    private static String normalizePath(String value) {\n        if (value == null || value.isBlank() || value.equals("/")) return "";\n        return value.replaceAll("/+$", "").toLowerCase();\n    }\n\n    private static void destroy(WebView webView) {''')
replace_once(resolver,
    '''            "if(!authorHref){const target=[...document.querySelectorAll('a[href]')].find(a=>{try{const h=abs(a.getAttribute('href')||'');if(!allowed(h)||blocked(h))return false;const y=new URL(h);const ps=y.pathname.split('/').filter(Boolean);return ps.length===1&&(ps[0]||'').replace(/^@/,'').toLowerCase()===handle.toLowerCase()}catch(e){return false}});if(target)authorHref=abs(target.getAttribute('href')||'')}" +\n            "const profileUrl=authorHref||(platform==='instagram'?('https://www.instagram.com/'+encodeURIComponent(handle)+'/'):('https://www.facebook.com/'+encodeURIComponent(handle)));" +''',
    '''            "if(!authorHref){const target=[...document.querySelectorAll('a[href]')].find(a=>{try{const h=abs(a.getAttribute('href')||'');if(!allowed(h)||blocked(h))return false;const y=new URL(h);const ps=y.pathname.split('/').filter(Boolean);return ps.length===1&&(ps[0]||'').replace(/^@/,'').toLowerCase()===handle.toLowerCase()}catch(e){return false}});if(target)authorHref=abs(target.getAttribute('href')||'')}" +\n            "const profileAnchor=authorHref?[...document.querySelectorAll('a[href]')].find(a=>abs(a.getAttribute('href')||'')===authorHref):null;" +\n            "const anchorName=clean(profileAnchor?.innerText||profileAnchor?.getAttribute('aria-label')||'');" +\n            "const avatarAlt=clean(profileAnchor?.querySelector?.('img')?.getAttribute('alt')||'');" +\n            "const altName=avatarAlt.replace(/^profile picture of /i,'').replace(/^profile photo of /i,'').replace(/'s profile picture$/i,'').replace(/'s profile photo$/i,'').replace(/^صورة الملف الشخصي لـ ?/,'').trim();" +\n            "const profileUrl=authorHref||(platform==='instagram'?('https://www.instagram.com/'+encodeURIComponent(handle)+'/'):('https://www.facebook.com/'+encodeURIComponent(handle)));" +''')
replace_once(resolver,
    '"const candidates=[rawMetaTitle,',
    '"const candidates=[rawMetaTitle,anchorName,altName,')
replace_once(resolver,
    '''            "const profileAnchor=authorHref?[...document.querySelectorAll('a[href]')].find(a=>abs(a.getAttribute('href')||'')===authorHref):null;const profileImage=imgSrc(profileAnchor?.querySelector?.('img'));" +''',
    '''            "const profileImage=imgSrc(profileAnchor?.querySelector?.('img'));" +''')

modal = "src/components/ExtractedPostsModal.tsx"
replace_once(modal, "import { SourceAvatar } from './SourceAvatar';", "import { SourceAvatar } from './SourceAvatar';\nimport { apiFetchSources } from '../services/api';")
replace_once(modal,
    '''  const [error, setError] = useState<string | null>(null);\n  const [sourceFilter, setSourceFilter] = useState<string>('all');\n\n  const deviceSources = useMemo(() => sources.filter(source => source.connectorType === 'device_session' && !source.isPaused), [sources]);\n  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources]);''',
    '''  const [error, setError] = useState<string | null>(null);\n  const [sourceFilter, setSourceFilter] = useState<string>('all');\n  const [runtimeSources, setRuntimeSources] = useState<Source[]>(sources);\n\n  useEffect(() => { if (sources.length > 0) setRuntimeSources(sources); }, [sources]);\n  const sourceMap = useMemo(() => new Map(runtimeSources.map(source => [source.id, source])), [runtimeSources]);''')
replace_once(modal,
    '''      const status = await DeviceSessionConnector.getLocalSession();\n      const eligible = deviceSources.filter(source => DeviceSessionConnector.isPlatformConnected(status, source.platform));\n      if (eligible.length === 0) throw new Error(locale === 'ar' ? 'اربط Facebook أو Instagram للمصادر المطلوبة أولًا.' : 'Connect Facebook or Instagram for the monitored sources first.');\n      const collected: NormalizedPost[] = [];\n      for (const source of eligible) {\n        try {\n          const rows = await connector.fetchLatest(source, 10, { commentsMode: 'none', includeMedia: true });''',
    '''      const status = await DeviceSessionConnector.getLocalSession();\n      let availableSources = sources;\n      try {\n        const fresh = await apiFetchSources();\n        if (Array.isArray(fresh) && fresh.length > 0) availableSources = fresh;\n      } catch { /* use hydrated context as a fallback */ }\n      if (availableSources.length === 0) {\n        await new Promise(resolve => window.setTimeout(resolve, 800));\n        try {\n          const retry = await apiFetchSources();\n          if (Array.isArray(retry) && retry.length > 0) availableSources = retry;\n        } catch { /* final fallback remains the context snapshot */ }\n      }\n      setRuntimeSources(availableSources);\n      const eligible = availableSources.filter(source => source.connectorType === 'device_session' && !source.isPaused && DeviceSessionConnector.isPlatformConnected(status, source.platform));\n      if (eligible.length === 0) throw new Error(locale === 'ar' ? 'اربط Facebook أو Instagram للمصادر المطلوبة أولًا.' : 'Connect Facebook or Instagram for the monitored sources first.');\n      const collected: NormalizedPost[] = [];\n      for (const source of eligible) {\n        try {\n          const rows = await connector.fetchLatest(source, 10, { commentsMode: 'none' });''')
replace_once(modal, "  }, [connector, deviceSources, locale]);", "  }, [connector, sources, locale]);")
replace_once(modal, "  const sourcesWithPosts = deviceSources.filter(source => posts.some(post => post.sourceId === source.id));", "  const sourcesWithPosts = runtimeSources.filter(source => source.connectorType === 'device_session' && posts.some(post => post.sourceId === source.id));")

connector = "src/connectors/deviceSessionConnector.ts"
replace_once(connector,
    '''    if (successfulDetails === 0) {\n      throw new Error('Posts were found, but authenticated comment/media details could not be collected right now.');\n    }''',
    '''    if (successfulDetails === 0 && commentsMode !== 'none') {\n      throw new Error('Posts were found, but authenticated comment/media details could not be collected right now.');\n    }''')

architecture = "server/tests/architectureRegression.test.ts"
replace_once(architecture, "  assert.match(resolver, /profileImage/);\n});", "  assert.match(resolver, /profileImage/);\n  assert.match(resolver, /hasRealDisplayName/);\n  assert.match(resolver, /webView\\.loadUrl\\(preferDesktopFacebookUrl\\(sourceUrl\\)\\)/);\n});")
replace_once(architecture,
    "  assert.match(connector, /maxDetailedPosts = commentsMode === 'all' \\? 5 : 20/);\n  assert.doesNotMatch(collector, /getCookie\\(|document\\.cookie|CookieManager.*getCookie/);",
    "  assert.match(connector, /maxDetailedPosts = commentsMode === 'all' \\? 5 : 20/);\n  assert.match(connector, /successfulDetails === 0 && commentsMode !== 'none'/);\n  assert.doesNotMatch(collector, /getCookie\\(|document\\.cookie|CookieManager.*getCookie/);")
marker = "test('Smart Grab forwards transient comments to AI without turning them into monitoring alerts', () => {"
text = Path(architecture).read_text()
if marker not in text:
    raise RuntimeError('architecture marker missing')
insert = '''test('extracted posts modal refreshes persisted sources and renders feed media without blocking on detail pages', () => {\n  const modal = read('src/components/ExtractedPostsModal.tsx');\n  assert.match(modal, /apiFetchSources/);\n  assert.match(modal, /fetchLatest\\(source, 10, \\{ commentsMode: 'none' \\}\\)/);\n  assert.match(modal, /data-extracted-image=\\"1\\"/);\n  assert.match(modal, /data-extracted-video=\\"1\\"/);\n  assert.doesNotMatch(modal, /includeMedia: true/);\n});\n\n'''
Path(architecture).write_text(text.replace(marker, insert + marker, 1))

print('V156_PRODUCT_FIX_SAFE_APPLIED=1')
