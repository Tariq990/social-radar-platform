from pathlib import Path

p = Path('android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java')
s = p.read_text(encoding='utf-8')

start = "              let sourceId = '';\n"
end = "              const cleanTitle = "
a = s.index(start)
b = s.index(end, a)
resolver = '''              let sourceId = '';
              let resolverPattern = -99;
              let resolverOccurrence = -1;
              const sourceCandidates = [];
              const sourceCandidatePatterns = [];
              const sourceCandidateOccurrences = [];
              const numericId = (raw) => {
                const value = String(raw || '').trim();
                if (value.length < 5 || value.length > 32) return '';
                return [...value].every(ch => ch >= '0' && ch <= '9') ? value : '';
              };
              const addCandidate = (raw, pattern, occurrence) => {
                const value = numericId(raw);
                if (!value || sourceCandidates.includes(value) || sourceCandidates.length >= 24) return;
                sourceCandidates.push(value);
                sourceCandidatePatterns.push(pattern);
                sourceCandidateOccurrences.push(occurrence);
              };
              try {
                const u = new URL(sourceUrl);
                addCandidate(u.searchParams.get('id') || '', -2, 0);
              } catch (_) {}

              const html = document.documentElement?.innerHTML || '';
              const scanAll = (marker, pattern, maxHits) => {
                let from = 0, occurrence = 0;
                while (occurrence < maxHits && sourceCandidates.length < 24) {
                  const at = html.indexOf(marker, from);
                  if (at < 0) break;
                  let pos = at + marker.length;
                  let digits = '';
                  while (pos < html.length && html[pos] >= '0' && html[pos] <= '9') digits += html[pos++];
                  addCandidate(digits, pattern, occurrence);
                  occurrence++;
                  from = at + marker.length;
                }
              };

              // Strong, source-specific markers first. Generic JSON id is last because an
              // authenticated Facebook document contains many unrelated object IDs.
              scanAll('fb://profile/', 0, 6);
              scanAll('fb://page/', 1, 6);
              scanAll('"pageID":"', 2, 6);
              scanAll('profile_id=', 4, 8);
              scanAll('"id":"', 3, 20);

              if (sourceCandidates.length === 0) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
              sourceId = sourceCandidates[0];
              resolverPattern = sourceCandidatePatterns[0];
              resolverOccurrence = sourceCandidateOccurrences[0];
              const candidatePatternCounts = [0,0,0,0,0];
              for (const pattern of sourceCandidatePatterns) {
                if (pattern >= 0 && pattern <= 4) candidatePatternCounts[pattern]++;
              }

'''
s = s[:a] + resolver + s[b:]

s = s.replace('const maxCandidates = Math.min(10, sourceCandidates.length);', 'const maxCandidates = Math.min(24, sourceCandidates.length);', 1)
s = s.replace('''                  sourceId = sourceCandidates[candidateIndex];
                  candidatesTried++;
''', '''                  sourceId = sourceCandidates[candidateIndex];
                  resolverPattern = sourceCandidatePatterns[candidateIndex];
                  resolverOccurrence = sourceCandidateOccurrences[candidateIndex];
                  candidatesTried++;
''', 1)
s = s.replace("let winningSourceId = '', winningCandidate = -1;", "let winningSourceId = '', winningCandidate = -1, winningResolverPattern = -99, winningResolverOccurrence = -1;", 1)
s = s.replace('''                    if (!winningSourceId) {
                      winningSourceId = sourceId;
                      winningCandidate = candidateIndex;
                    }
''', '''                    if (!winningSourceId) {
                      winningSourceId = sourceId;
                      winningCandidate = candidateIndex;
                      winningResolverPattern = resolverPattern;
                      winningResolverOccurrence = resolverOccurrence;
                    }
''', 1)
old_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, winningCandidate, resolverPattern}"
new_diag = "diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, queryErrors, winningCandidate, winningResolverPattern, winningResolverOccurrence, p0:candidatePatternCounts[0], p1:candidatePatternCounts[1], p2:candidatePatternCounts[2], p3:candidatePatternCounts[3], p4:candidatePatternCounts[4]}"
if s.count(old_diag) != 1:
    raise SystemExit('DIAGNOSTIC_ANCHOR_MISMATCH')
s = s.replace(old_diag, new_diag, 1)

old_log = '''                        int winningCandidate = diagnostics == null ? -1 : diagnostics.optInt("winningCandidate", -1);
                        int resolverPattern = diagnostics == null ? -99 : diagnostics.optInt("resolverPattern", -99);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " winner=" + winningCandidate +
                            " resolver=" + resolverPattern);
'''
new_log = '''                        int winningCandidate = diagnostics == null ? -1 : diagnostics.optInt("winningCandidate", -1);
                        int queryErrors = diagnostics == null ? 0 : diagnostics.optInt("queryErrors", 0);
                        int winningResolverPattern = diagnostics == null ? -99 : diagnostics.optInt("winningResolverPattern", -99);
                        int winningResolverOccurrence = diagnostics == null ? -1 : diagnostics.optInt("winningResolverOccurrence", -1);
                        int p0 = diagnostics == null ? 0 : diagnostics.optInt("p0", 0);
                        int p1 = diagnostics == null ? 0 : diagnostics.optInt("p1", 0);
                        int p2 = diagnostics == null ? 0 : diagnostics.optInt("p2", 0);
                        int p3 = diagnostics == null ? 0 : diagnostics.optInt("p3", 0);
                        int p4 = diagnostics == null ? 0 : diagnostics.optInt("p4", 0);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " qerr=" + queryErrors +
                            " winner=" + winningCandidate + " winp=" + winningResolverPattern +
                            " wino=" + winningResolverOccurrence + " p0=" + p0 + " p1=" + p1 +
                            " p2=" + p2 + " p3=" + p3 + " p4=" + p4);
'''
if s.count(old_log) != 1:
    raise SystemExit('LOG_ANCHOR_MISMATCH')
s = s.replace(old_log, new_log, 1)

p.write_text(s, encoding='utf-8')
print('FACEBOOK_ID_SWEEP_PATCH_APPLIED')
