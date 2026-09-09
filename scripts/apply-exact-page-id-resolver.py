from pathlib import Path

p = Path('android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java')
s = p.read_text(encoding='utf-8')

old_desktop = '''    private static String desktopUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null || host.equalsIgnoreCase("fb.watch")) return rawUrl;
            return uri.buildUpon().authority("www.facebook.com").build().toString();
        } catch (Exception ignored) {
            return rawUrl;
        }
    }
'''
new_desktop = '''    private static String desktopUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null || host.equalsIgnoreCase("fb.watch")) return rawUrl;
            Uri.Builder builder = uri.buildUpon().authority("www.facebook.com");
            if (uri.getQueryParameter("locale") == null) {
                builder.appendQueryParameter("locale", "en_US");
            }
            return builder.build().toString();
        } catch (Exception ignored) {
            return rawUrl;
        }
    }
'''
if s.count(old_desktop) != 1:
    raise SystemExit('DESKTOP_URL_ANCHOR_MISMATCH')
s = s.replace(old_desktop, new_desktop, 1)

start = "              let sourceId = '';\n"
end = "              const cleanTitle = "
a = s.index(start)
b = s.index(end, a)
resolver = '''              let requestedHandle = '';
              try {
                const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean);
                if (parts[0] && !['profile.php','groups'].includes(parts[0].toLowerCase())) requestedHandle = parts[0].replace('@','');
              } catch (_) {}

              let sourceId = '';
              let resolverPattern = -1;
              const numericId = (raw) => {
                const value = String(raw || '').trim();
                if (value.length < 5 || value.length > 32) return '';
                return [...value].every(ch => ch >= '0' && ch <= '9') ? value : '';
              };
              try {
                const u = new URL(sourceUrl);
                const direct = numericId(u.searchParams.get('id') || '');
                if (direct) { sourceId = direct; resolverPattern = -2; }
              } catch (_) {}

              // Semantic port of facebook-graphql-scraper/client.py::get_page_id:
              // first matching pattern wins on the locale=en_US Facebook document.
              const html = document.documentElement?.innerHTML || '';
              const firstDigitsAfter = (text, marker) => {
                const value = String(text || '');
                const at = value.indexOf(marker);
                if (at < 0) return '';
                let pos = at + marker.length;
                let digits = '';
                while (pos < value.length && value[pos] >= '0' && value[pos] <= '9') digits += value[pos++];
                return numericId(digits);
              };
              if (!sourceId) {
                const markers = [
                  'fb://profile/',
                  'fb://page/',
                  '\"pageID\":\"',
                  '\"id\":\"',
                  'profile_id='
                ];
                for (let i = 0; i < markers.length; i++) {
                  const candidate = firstDigitsAfter(html, markers[i]);
                  if (candidate) { sourceId = candidate; resolverPattern = i; break; }
                }
              }
              if (!sourceId) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
              const sourceCandidates = [sourceId];

'''
s = s[:a] + resolver + s[b:]

old_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, winningCandidate}"
new_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, winningCandidate, resolverPattern}"
if s.count(old_diag) != 1:
    raise SystemExit('DIAGNOSTIC_ANCHOR_MISMATCH')
s = s.replace(old_diag, new_diag, 1)

old_log = '''                        int winningCandidate = diagnostics == null ? -1 : diagnostics.optInt("winningCandidate", -1);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " winner=" + winningCandidate);
'''
new_log = '''                        int winningCandidate = diagnostics == null ? -1 : diagnostics.optInt("winningCandidate", -1);
                        int resolverPattern = diagnostics == null ? -99 : diagnostics.optInt("resolverPattern", -99);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " winner=" + winningCandidate +
                            " resolver=" + resolverPattern);
'''
if s.count(old_log) != 1:
    raise SystemExit('LOG_ANCHOR_MISMATCH')
s = s.replace(old_log, new_log, 1)

p.write_text(s, encoding='utf-8')
print('EXACT_PAGE_ID_RESOLVER_PATCH_APPLIED')
