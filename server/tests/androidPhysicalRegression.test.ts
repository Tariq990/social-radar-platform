import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('foreground Meta collector stays fully renderable and starts DOM polling before page-finished', () => {
  const host = read('android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java');
  const collector = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java');

  assert.match(host, /root\.addView\(host, hostParams\)/);
  assert.match(host, /host\.addView\(webView, webParams\)/);
  assert.match(host, /new FrameLayout\.LayoutParams\(1, 1\)/);
  assert.match(host, /webView\.setAlpha\(1f\)/);
  assert.match(host, /webView\.setLayerType\(View\.LAYER_TYPE_HARDWARE, null\)/);
  assert.match(host, /webView\.resumeTimers\(\)/);
  assert.doesNotMatch(host, /setAlpha\(0\.01f\)/);

  assert.match(collector, /TIMEOUT_MS = 45_000/);
  assert.match(collector, /PAGE_STARTED_EXTRACTION_DELAY_MS = 900/);
  assert.match(collector, /EVALUATION_WATCHDOG_MS = 2_500/);
  assert.match(collector, /evaluationInFlight/);
  assert.match(collector, /void onPageStarted\(WebView view, String loadedUrl/);
  assert.match(collector, /scheduleExtraction\(PAGE_STARTED_EXTRACTION_DELAY_MS\)/);
  assert.match(collector, /main\.postDelayed\(extractionRunner\[0\], PAGE_STARTED_EXTRACTION_DELAY_MS\)/);
});

test('Android update check keeps the app bootstrap mounted instead of serializing startup behind a dark screen', () => {
  const gate = read('src/components/ForceUpdateGate.tsx');
  const marker = 'Keep children mounted while the update check runs so auth/session bootstrap happens in parallel instead of serially.';
  assert.match(gate, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(gate, /const \[checking, setChecking\] = useState\(false\)/);
  assert.match(gate, /fixed inset-0 z-\[100\]/);
  assert.match(gate, /MR SCRAP/);

  const nativeBlock = gate.indexOf('if (!requiredUpdate)');
  const childMount = gate.indexOf('{children}', nativeBlock);
  const checkingOverlay = gate.indexOf('{checking ?', nativeBlock);
  assert.ok(nativeBlock >= 0 && childMount > nativeBlock && checkingOverlay > childMount);
});
