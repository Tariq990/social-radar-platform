from pathlib import Path

p = Path('android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java')
s = p.read_text(encoding='utf-8')

start = "              let sourceId = '';\n"
end = "              const cleanTitle = "
a = s.index(start)
b = s.index(end, a)
resolver = r'''              let sourceId = '';
              let resolverPattern = -99;
              let resolverOccurrence = -1;
              let resolverKey = '';
              const sourceCandidates = [];
              const sourceCandidatePatterns = [];
              const sourceCandidateOccurrences = [];
              const sourceCandidateKeys = [];
              const numericId = (raw) => {
                const value = String(raw || '').trim();
                if (value.length < 5 || value.length > 32) return '';
                return [...value].every(ch => ch >= '0' && ch <= '9') ? value : '';
              };
              const safeKey = (raw) => String(raw || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 48);
              const addCandidate = (raw, pattern, occurrence, key) => {
                const value = numericId(raw);
                if (!value || sourceCandidates.includes(value) || sourceCandidates.length >= 24) return false;
                sourceCandidates.push(value);
                sourceCandidatePatterns.push(pattern);
                sourceCandidateOccurrences.push(occurrence);
                sourceCandidateKeys.push(safeKey(key));
                return true;
              };
              try {
                const u = new URL(sourceUrl);
                addCandidate(u.searchParams.get('id') || '', -2, 0, 'query_id');
              } catch (_) {}

              const html = document.documentElement?.innerHTML || '';
              const scanAll = (marker, pattern, maxHits, key) => {
                let from = 0, occurrence = 0;
                while (occurrence < maxHits && sourceCandidates.length < 24) {
                  const at = html.indexOf(marker, from);
                  if (at < 0) break;
                  let pos = at + marker.length;
                  let digits = '';
                  while (pos < html.length && html[pos] >= '0' && html[pos] <= '9') digits += html[pos++];
                  addCandidate(digits, pattern, occurrence, key);
                  occurrence++;
                  from = at + marker.length;
                }
              };

              scanAll('fb://profile/', 0, 6, 'fb_profile');
              scanAll('fb://page/', 1, 6, 'fb_page');
              scanAll('"pageID":"', 2, 6, 'pageID');
              scanAll('profile_id=', 4, 8, 'profile_id');

              // The authenticated WebView bootstrap does not expose the target under the
              // traditional keys. Search only around the requested handle and collect nearby
              // numeric schema values. Values stay in-memory; diagnostics expose key names only.
              let handleHits = 0;
              let contextualCandidates = 0;
              const contextKeys = new Set();
              if (requestedHandle) {
                const lower = html.toLowerCase();
                const needle = requestedHandle.toLowerCase();
                let from = 0;
                while (handleHits < 12 && sourceCandidates.length < 24) {
                  const at = lower.indexOf(needle, from);
                  if (at < 0) break;
                  handleHits++;
                  let windowText = html.slice(Math.max(0, at - 7000), Math.min(html.length, at + needle.length + 7000));
                  windowText = windowText.replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
                  const jsonRe = /["']([A-Za-z][A-Za-z0-9_]{1,48})["']\s*:\s*["']?(\d{5,32})/g;
                  const queryRe = /([A-Za-z][A-Za-z0-9_]{1,48})=(\d{5,32})/g;
                  for (const re of [jsonRe, queryRe]) {
                    re.lastIndex = 0;
                    let match;
                    let localOccurrence = 0;
                    while ((match = re.exec(windowText)) && sourceCandidates.length < 24 && localOccurrence < 24) {
                      const key = safeKey(match[1]);
                      if (key) contextKeys.add(key);
                      if (addCandidate(match[2], 5, localOccurrence, key)) contextualCandidates++;
                      localOccurrence++;
                    }
                  }
                  from = at + needle.length;
                }
              }

              // Generic IDs are a final fallback only after handle-context candidates.
              scanAll('"id":"', 3, 20, 'id');

              if (sourceCandidates.length === 0) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
              sourceId = sourceCandidates[0];
              resolverPattern = sourceCandidatePatterns[0];
              resolverOccurrence = sourceCandidateOccurrences[0];
              resolverKey = sourceCandidateKeys[0];
              const candidatePatternCounts = [0,0,0,0,0,0];
              for (const pattern of sourceCandidatePatterns) {
                if (pattern >= 0 && pattern <= 5) candidatePatternCounts[pattern]++;
              }
              const contextKeySummary = [...contextKeys].slice(0, 12).join('.');

'''
s = s[:a] + resolver + s[b:]

s = s.replace("let winningSourceId = '', winningCandidate = -1, winningResolverPattern = -99, winningResolverOccurrence = -1;", "let winningSourceId = '', winningCandidate = -1, winningResolverPattern = -99, winningResolverOccurrence = -1, winningResolverKey = '';", 1)
s = s.replace('''                  resolverPattern = sourceCandidatePatterns[candidateIndex];
                  resolverOccurrence = sourceCandidateOccurrences[candidateIndex];
                  candidatesTried++;
''', '''                  resolverPattern = sourceCandidatePatterns[candidateIndex];
                  resolverOccurrence = sourceCandidateOccurrences[candidateIndex];
                  resolverKey = sourceCandidateKeys[candidateIndex];
                  candidatesTried++;
''', 1)
s = s.replace('''                      winningResolverPattern = resolverPattern;
                      winningResolverOccurrence = resolverOccurrence;
''', '''                      winningResolverPattern = resolverPattern;
                      winningResolverOccurrence = resolverOccurrence;
                      winningResolverKey = resolverKey;
''', 1)
old_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, queryErrors, winningCandidate, winningResolverPattern, winningResolverOccurrence, p0:candidatePatternCounts[0], p1:candidatePatternCounts[1], p2:candidatePatternCounts[2], p3:candidatePatternCounts[3], p4:candidatePatternCounts[4]}"
new_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, queryErrors, winningCandidate, winningResolverPattern, winningResolverOccurrence, winningResolverKey, handleHits, contextualCandidates, contextKeySummary, p0:candidatePatternCounts[0], p1:candidatePatternCounts[1], p2:candidatePatternCounts[2], p3:candidatePatternCounts[3], p4:candidatePatternCounts[4], p5:candidatePatternCounts[5]}"
if s.count(old_diag) != 1:
    raise SystemExit('DIAGNOSTIC_ANCHOR_MISMATCH')
s = s.replace(old_diag, new_diag, 1)

old_log = '''                        int p4 = diagnostics == null ? 0 : diagnostics.optInt("p4", 0);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " qerr=" + queryErrors +
                            " winner=" + winningCandidate + " winp=" + winningResolverPattern +
                            " wino=" + winningResolverOccurrence + " p0=" + p0 + " p1=" + p1 +
                            " p2=" + p2 + " p3=" + p3 + " p4=" + p4);
'''
new_log = '''                        int p4 = diagnostics == null ? 0 : diagnostics.optInt("p4", 0);
                        int p5 = diagnostics == null ? 0 : diagnostics.optInt("p5", 0);
                        int handleHits = diagnostics == null ? 0 : diagnostics.optInt("handleHits", 0);
                        int contextualCandidates = diagnostics == null ? 0 : diagnostics.optInt("contextualCandidates", 0);
                        String winningResolverKey = safeCode(diagnostics == null ? "none" : diagnostics.optString("winningResolverKey", "none"));
                        String contextKeySummary = safeCode(diagnostics == null ? "none" : diagnostics.optString("contextKeySummary", "none"));
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " qerr=" + queryErrors +
                            " winner=" + winningCandidate + " winp=" + winningResolverPattern +
                            " wino=" + winningResolverOccurrence + " wink=" + winningResolverKey +
                            " handleHits=" + handleHits + " contextual=" + contextualCandidates +
                            " p0=" + p0 + " p1=" + p1 + " p2=" + p2 + " p3=" + p3 +
                            " p4=" + p4 + " p5=" + p5 + " keys=" + contextKeySummary);
'''
if s.count(old_log) != 1:
    raise SystemExit('LOG_ANCHOR_MISMATCH')
s = s.replace(old_log, new_log, 1)

p.write_text(s, encoding='utf-8')
print('FACEBOOK_CONTEXT_ID_SWEEP_PATCH_APPLIED')
