from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


host_path = 'android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java'
host = '''package com.mrscrap.socialradar;

import android.app.Activity;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/**
 * Gives foreground authenticated collectors a real window lifecycle without exposing the
 * Facebook/Instagram page to the React bridge. Background WorkManager collectors deliberately
 * fall back to an application-context detached WebView because no Activity exists there.
 */
final class ForegroundWebViewHost {
    private ForegroundWebViewHost() {}

    static Context contextFor(Context context) {
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            if (!activity.isFinishing() && !activity.isDestroyed()) return activity;
        }
        return context.getApplicationContext();
    }

    static boolean attachIfPossible(Context context, WebView webView, int width, int height) {
        if (!(context instanceof Activity)) return false;
        Activity activity = (Activity) context;
        if (activity.isFinishing() || activity.isDestroyed()) return false;
        View content = activity.findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return false;

        ViewGroup root = (ViewGroup) content;
        webView.setVisibility(View.VISIBLE);
        webView.setAlpha(0.01f);
        webView.setClickable(false);
        webView.setFocusable(false);
        webView.setFocusableInTouchMode(false);
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(
            Math.max(1, width),
            Math.max(1, height)
        );
        // Index 0 keeps the collector behind the Capacitor app while still attached/visible to
        // Android's window lifecycle, which is required by modern lazy-rendered Meta feeds.
        root.addView(webView, 0, params);
        webView.onResume();
        return true;
    }

    static void destroy(WebView webView) {
        try {
            webView.stopLoading();
            webView.onPause();
            webView.clearHistory();
            android.view.ViewParent parent = webView.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(webView);
            webView.removeAllViews();
            webView.destroy();
        } catch (Exception ignored) {}
    }
}
'''
write(host_path, host)

collector_path = 'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java'
collector = read(collector_path)
collector = replace_once(
    collector,
    '            WebView webView = new WebView(context.getApplicationContext());',
    '            WebView webView = new WebView(ForegroundWebViewHost.contextFor(context));',
    'AuthenticatedWebCollector context'
)
collector = replace_once(
    collector,
    '            webView.layout(0, 0, viewportWidth, viewportHeight);\n\n            CookieManager cookieManager = CookieManager.getInstance();',
    '            webView.layout(0, 0, viewportWidth, viewportHeight);\n            ForegroundWebViewHost.attachIfPossible(context, webView, viewportWidth, viewportHeight);\n\n            CookieManager cookieManager = CookieManager.getInstance();',
    'AuthenticatedWebCollector attachment'
)
old_destroy = '''    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.clearHistory();
                android.view.ViewParent parent = webView.getParent();
                if (parent instanceof android.view.ViewGroup) ((android.view.ViewGroup) parent).removeView(webView);
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }
'''
new_destroy = '''    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> ForegroundWebViewHost.destroy(webView));
    }
'''
collector = replace_once(collector, old_destroy, new_destroy, 'AuthenticatedWebCollector destroy')
write(collector_path, collector)

detail_path = 'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java'
detail = read(detail_path)
detail = replace_once(
    detail,
    '            WebView webView = new WebView(context.getApplicationContext());',
    '            WebView webView = new WebView(ForegroundWebViewHost.contextFor(context));',
    'AuthenticatedPostDetailCollector context'
)
detail = replace_once(
    detail,
    '            webView.layout(0, 0, viewportWidth, viewportHeight);\n\n            CookieManager cookies = CookieManager.getInstance();',
    '            webView.layout(0, 0, viewportWidth, viewportHeight);\n            ForegroundWebViewHost.attachIfPossible(context, webView, viewportWidth, viewportHeight);\n\n            CookieManager cookies = CookieManager.getInstance();',
    'AuthenticatedPostDetailCollector attachment'
)
old_detail_destroy = '''    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.clearHistory();
                android.view.ViewParent parent = webView.getParent();
                if (parent instanceof android.view.ViewGroup) ((android.view.ViewGroup) parent).removeView(webView);
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }
'''
new_detail_destroy = '''    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> ForegroundWebViewHost.destroy(webView));
    }
'''
detail = replace_once(detail, old_detail_destroy, new_detail_destroy, 'AuthenticatedPostDetailCollector destroy')
write(detail_path, detail)

plugin_path = 'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java'
plugin = read(plugin_path)
plugin = replace_once(
    plugin,
    '        AuthenticatedWebCollector.collect(getContext(), url, limit, new AuthenticatedWebCollector.Callback() {',
    '        AuthenticatedWebCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {',
    'collectSource foreground context'
)
plugin = replace_once(
    plugin,
    '        AuthenticatedPostDetailCollector.collect(\n            getContext(),',
    '        AuthenticatedPostDetailCollector.collect(\n            foregroundContext(),',
    'collectPostDetails foreground context'
)
plugin = replace_once(
    plugin,
    '    private static String uniqueWorkName(String sourceId) {',
    '''    private Context foregroundContext() {
        Activity activity = getActivity();
        return activity != null ? activity : getContext();
    }

    private static String uniqueWorkName(String sourceId) {''',
    'foregroundContext helper'
)
write(plugin_path, plugin)

panel_path = 'src/components/SmartGrabPanel.tsx'
panel = read(panel_path)
insert_after = '''async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}
'''
helper = insert_after + '''
function describeCollectionFailure(raw: string | undefined, source: Source, locale: 'ar' | 'en'): string {
  const message = String(raw || '').trim();
  const platform = source.platform === 'instagram' ? 'Instagram' : 'Facebook';
  if (/SESSION_CHECKPOINT/i.test(message)) {
    return locale === 'ar'
      ? `${platform} يطلب تحققًا إضافيًا على الجهاز. افتح الاتصال من الإعدادات وأكمل التحقق ثم أعد المحاولة.`
      : `${platform} requires an additional on-device verification. Open the connection in Settings, complete it, then retry.`;
  }
  if (/SESSION_REQUIRED|session expired|session is not connected/i.test(message)) {
    return locale === 'ar'
      ? `انتهت جلسة ${platform} على الجهاز أو لم تعد صالحة. أعد ربط ${platform} من الإعدادات.`
      : `The on-device ${platform} session expired or is no longer usable. Reconnect ${platform} in Settings.`;
  }
  if (message.startsWith('NO_EXTRACTABLE_POSTS')) {
    const safeDiagnostics = message.split('|').slice(1).filter(part => /^(surface|containers|anchors|postLinks|body)=[A-Za-z0-9._:-]+$/.test(part));
    const suffix = safeDiagnostics.length ? ` [${safeDiagnostics.join(' · ')}]` : '';
    return locale === 'ar'
      ? `فتح الجهاز صفحة ${platform} لكنه لم يجد منشورات قابلة للاستخراج.${suffix}`
      : `The device opened the ${platform} page but found no extractable posts.${suffix}`;
  }
  if (/timed out/i.test(message)) {
    return locale === 'ar'
      ? `انتهت مهلة تحميل صفحة ${platform} على الجهاز قبل اكتمال الجلب.`
      : `The on-device ${platform} page timed out before collection completed.`;
  }
  if (/SOURCE_METADATA_UNAVAILABLE|Could not resolve reliable source metadata/i.test(message)) {
    return locale === 'ar'
      ? `تم فتح ${platform} لكن تعذر تثبيت هوية المصدر من الصفحة الحالية.`
      : `${platform} opened, but the source identity could not be resolved from the current page.`;
  }
  return locale === 'ar'
    ? `تعذر استخراج منشورات حقيقية من ${platform} على الجهاز الآن.`
    : `Could not extract real ${platform} posts on this device right now.`;
}
'''
panel = replace_once(panel, insert_after, helper, 'SmartGrab diagnostic helper')
old_empty = '''      const failed = collected.filter(item => item.posts.length === 0);
      if (batches.length === 0) {
        throw new Error(locale === 'ar' ? 'لم يتمكن الجهاز من استخراج منشورات حقيقية من المصادر المختارة الآن.' : 'The device could not extract real posts from the selected sources right now.');
      }
'''
new_empty = '''      const failed = collected.filter(item => item.posts.length === 0);
      if (batches.length === 0) {
        const firstFailure = failed.find(item => item.error);
        if (firstFailure) throw new Error(describeCollectionFailure(firstFailure.error, firstFailure.source, locale));
        throw new Error(locale === 'ar' ? 'لم يجد الجهاز منشورات متاحة للاستخراج من المصادر المختارة الآن.' : 'The device found no extractable posts in the selected sources right now.');
      }
'''
panel = replace_once(panel, old_empty, new_empty, 'SmartGrab all-source failure')
write(panel_path, panel)

test_path = 'server/tests/architectureRegression.test.ts'
tests = read(test_path)
test_append = '''

test('foreground Smart Grab uses an Activity-attached Meta WebView while background retains a safe fallback', () => {
  const host = read('android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java');
  const plugin = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java');
  const collector = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java');
  const detail = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java');
  const worker = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceWorker.java');
  assert.match(host, /root\.addView\(webView, 0, params\)/);
  assert.match(host, /webView\.onResume\(\)/);
  assert.match(host, /context instanceof Activity/);
  assert.match(plugin, /AuthenticatedWebCollector\.collect\(foregroundContext\(\)/);
  assert.match(plugin, /AuthenticatedPostDetailCollector\.collect\([\s\S]*foregroundContext\(\)/);
  assert.match(collector, /ForegroundWebViewHost\.contextFor\(context\)/);
  assert.match(collector, /ForegroundWebViewHost\.attachIfPossible/);
  assert.match(detail, /ForegroundWebViewHost\.attachIfPossible/);
  assert.match(worker, /AuthenticatedWebCollector\.collect\(getApplicationContext\(\)/);
});

test('Smart Grab surfaces sanitized native collection diagnostics instead of discarding them', () => {
  const panel = read('src/components/SmartGrabPanel.tsx');
  assert.match(panel, /function describeCollectionFailure/);
  assert.match(panel, /NO_EXTRACTABLE_POSTS/);
  assert.match(panel, /SESSION_CHECKPOINT/);
  assert.match(panel, /const firstFailure = failed\.find\(item => item\.error\)/);
  assert.match(panel, /describeCollectionFailure\(firstFailure\.error, firstFailure\.source, locale\)/);
  assert.doesNotMatch(panel, /if \(batches\.length === 0\) \{\s*throw new Error\(locale === 'ar' \? 'لم يتمكن الجهاز من استخراج منشورات حقيقية من المصادر المختارة الآن\.'/s);
});
'''
if "foreground Smart Grab uses an Activity-attached Meta WebView" in tests:
    raise SystemExit('architecture tests already patched')
tests += test_append
write(test_path, tests)

print('Foreground WebView and diagnostic patch applied.')
