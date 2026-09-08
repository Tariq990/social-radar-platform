from pathlib import Path

p = Path('server/tests/architectureRegression.test.ts')
text = p.read_text()
paths = [
    'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java',
    'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java',
    'android/app/src/main/res/raw/mrscrap_post_detail_extractor.js',
    'src/connectors/deviceSessionConnector.ts',
    'src/components/SmartGrabPanel.tsx',
    'server/worker/deviceExplore.ts',
    'server/ai/aiService.ts',
]
for path in paths:
    old_single = f"readFileSync('{path}', 'utf8')"
    old_double = f'readFileSync("{path}", "utf8")'
    if old_single in text:
        text = text.replace(old_single, f"read('{path}')")
    elif old_double in text:
        text = text.replace(old_double, f"read('{path}')")
    elif f"read('{path}')" not in text:
        raise SystemExit(f'missing regression read target: {path}')
p.write_text(text.rstrip() + '\n')
print('comment regression test readers repaired')
