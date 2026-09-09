from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, got {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    "AuthenticatedWebCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {",
    "FacebookGraphqlWebViewCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {",
)

replace_once(
    "server/tests/androidPhysicalRegression.test.ts",
    """  assert.match(plugin, /MRSCRAP_FLOW/);\n  assert.match(plugin, /event=collect_source_enter/);\n});\n""",
    """  assert.match(plugin, /MRSCRAP_FLOW/);\n  assert.match(plugin, /event=collect_source_enter/);\n  assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect/);\n\n  const graphqlCollector = read('android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java');\n  assert.match(graphqlCollector, /ProfileCometTimelineFeedRefetchQuery/);\n  assert.match(graphqlCollector, /27465012859856795/);\n  assert.match(graphqlCollector, /\\/api\\/graphql\\//);\n  assert.match(graphqlCollector, /timeline_list_feed_units/);\n  assert.match(graphqlCollector, /credentials:'include'/);\n  assert.doesNotMatch(graphqlCollector, /getCookie\\(/);\n});\n""",
)

replace_once(
    "server/tests/architectureRegression.test.ts",
    "assert.match(plugin, /AuthenticatedWebCollector\\.collect\\(foregroundContext\\(\\)/);",
    "assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect\\(foregroundContext\\(\\)/);",
)

# Java text blocks parse escapes before JavaScript reaches WebView. Keep source-id
# discovery regex-free so the generated Java is valid and the JS semantics are stable.
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java",
    r'''              const metaApp = document.querySelector('meta[property="al:ios:url"], meta[property="al:android:url"]')?.content || '';
              const html = document.documentElement?.innerHTML || '';
              const idPatterns = [
                /fb:\/\/(?:profile|page)\/(\d{5,})/i,
                /["']profile_id["']\s*[:=]\s*["']?(\d{5,})/i,
                /["']pageID["']\s*:\s*["'](\d{5,})["']/i,
                /profile_id=(\d{5,})/i
              ];
              if (!sourceId) {
                for (const pattern of idPatterns) {
                  const match = String(metaApp).match(pattern) || html.match(pattern);
                  if (match?.[1]) { sourceId = match[1]; break; }
                }
              }
              if (!/^\d{5,}$/.test(sourceId)) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
''',
    '''              const metaApp = document.querySelector('meta[property="al:ios:url"], meta[property="al:android:url"]')?.content || '';
              const html = document.documentElement?.innerHTML || '';
              const longestDigitRun = (value) => {
                let best = '', current = '';
                for (const ch of String(value || '')) {
                  if (ch >= '0' && ch <= '9') {
                    current += ch;
                    if (current.length > best.length) best = current;
                  } else {
                    current = '';
                  }
                }
                return best.length >= 5 ? best : '';
              };
              if (!sourceId) {
                const candidates = [String(metaApp), html];
                const markers = ['fb://profile/', 'fb://page/', 'profile_id', 'pageID'];
                outer: for (const candidate of candidates) {
                  for (const marker of markers) {
                    const markerIndex = candidate.indexOf(marker);
                    if (markerIndex < 0) continue;
                    const digits = longestDigitRun(candidate.slice(markerIndex + marker.length, markerIndex + marker.length + 96));
                    if (digits) { sourceId = digits; break outer; }
                  }
                }
              }
              const numericSourceId = sourceId.length >= 5 && [...sourceId].every(ch => ch >= '0' && ch <= '9');
              if (!numericSourceId) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
''',
)
