from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, got {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Never block normal startup on a network update check. A confirmed mandatory update still
# replaces the app UI as soon as the backend decision arrives.
replace_once(
    "src/components/ForceUpdateGate.tsx",
    "const [checking, setChecking] = useState(isNativeAndroid());",
    "const [checking, setChecking] = useState(false);"
)

# Bound the updater request so a cold/sleeping backend cannot leave an Android launch hanging.
replace_once(
    "src/services/appUpdate.ts",
    """  const response = await fetch(\n    `${baseUrl}/api/app/update?versionCode=${encodeURIComponent(String(installed.versionCode))}`,\n    { credentials: 'omit', cache: 'no-store' }\n  );\n  const raw = await response.text();\n""",
    """  const controller = new AbortController();\n  const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);\n  let response: Response;\n  try {\n    response = await fetch(\n      `${baseUrl}/api/app/update?versionCode=${encodeURIComponent(String(installed.versionCode))}`,\n      { credentials: 'omit', cache: 'no-store', signal: controller.signal }\n    );\n  } finally {\n    globalThis.clearTimeout(timeout);\n  }\n  const raw = await response.text();\n"""
)

# Show an actual Android splash icon instead of a blank dark launch surface while Capacitor creates
# its WebView.
replace_once(
    "android/app/src/main/res/values/styles.xml",
    """    <style name=\"AppTheme.NoActionBarLaunch\" parent=\"Theme.SplashScreen\">\n        <item name=\"windowSplashScreenBackground\">@color/splashBackground</item>\n        <item name=\"postSplashScreenTheme\">@style/AppTheme</item>\n    </style>\n""",
    """    <style name=\"AppTheme.NoActionBarLaunch\" parent=\"Theme.SplashScreen\">\n        <item name=\"windowSplashScreenBackground\">@color/splashBackground</item>\n        <item name=\"windowSplashScreenAnimatedIcon\">@mipmap/ic_launcher_foreground</item>\n        <item name=\"windowSplashScreenIconBackgroundColor\">@color/launcherBackground</item>\n        <item name=\"postSplashScreenTheme\">@style/AppTheme</item>\n    </style>\n"""
)

# 2) Keep the authenticated collector genuinely visible to Android's compositor without covering
# the Capacitor app. A 1x1 topmost clipping host has a visible intersection, while the child WebView
# retains a full phone-sized layout/JS viewport.
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java",
    "import android.view.ViewGroup;\nimport android.webkit.WebView;",
    "import android.view.ViewGroup;\nimport android.view.Gravity;\nimport android.webkit.WebView;\nimport android.widget.FrameLayout;"
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java",
    """        ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(\n            Math.max(1, width),\n            Math.max(1, height)\n        );\n        // Index 0 keeps the collector behind the Capacitor app while still attached/visible to\n        // Android's window lifecycle, which is required by modern lazy-rendered Meta feeds.\n        root.addView(webView, 0, params);\n        webView.onResume();\n""",
    """        FrameLayout host = new FrameLayout(activity);\n        host.setClipChildren(true);\n        host.setClipToPadding(true);\n        host.setClickable(false);\n        host.setFocusable(false);\n        host.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);\n\n        FrameLayout.LayoutParams hostParams = new FrameLayout.LayoutParams(1, 1);\n        hostParams.gravity = Gravity.TOP | Gravity.START;\n        // Keep one physical pixel topmost so Surface/WebView visibility accounting cannot mark the\n        // collector fully occluded, while clipping all Facebook/Instagram pixels from the user.\n        root.addView(host, hostParams);\n\n        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(\n            Math.max(1, width),\n            Math.max(1, height)\n        );\n        host.addView(webView, webParams);\n        webView.onResume();\n"""
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java",
    """            android.view.ViewParent parent = webView.getParent();\n            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(webView);\n            webView.removeAllViews();\n""",
    """            android.view.ViewParent parent = webView.getParent();\n            if (parent instanceof ViewGroup) {\n                ViewGroup host = (ViewGroup) parent;\n                host.removeView(webView);\n                android.view.ViewParent hostParent = host.getParent();\n                if (host.getChildCount() == 0 && hostParent instanceof ViewGroup) {\n                    ((ViewGroup) hostParent).removeView(host);\n                }\n            }\n            webView.removeAllViews();\n"""
)

collector = "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java"
replace_once(
    collector,
    "import android.os.Looper;\nimport android.view.View;",
    "import android.os.Looper;\nimport android.util.Log;\nimport android.view.View;"
)
replace_once(
    collector,
    """    private static final long RETRY_DELAY_MS = 750;\n    private static final int SURFACE_FALLBACK_ATTEMPT = 4;\n""",
    """    private static final long RETRY_DELAY_MS = 750;\n    private static final long EVALUATION_WATCHDOG_MS = 2_500;\n    private static final int SURFACE_FALLBACK_ATTEMPT = 4;\n"""
)
replace_once(
    collector,
    """    private static final int MAX_LIMIT = 20;\n\n    private AuthenticatedWebCollector() {}\n""",
    """    private static final int MAX_LIMIT = 20;\n    private static final String TAG = \"MRSCRAP_COLLECTOR\";\n\n    private AuthenticatedWebCollector() {}\n"""
)
replace_once(
    collector,
    """            AtomicBoolean finished = new AtomicBoolean(false);\n            int[] attempts = new int[] { 0 };\n            boolean[] triedMobileFallback = new boolean[] { false };\n""",
    """            AtomicBoolean finished = new AtomicBoolean(false);\n            AtomicBoolean evaluationInFlight = new AtomicBoolean(false);\n            int[] evaluationGeneration = new int[] { 0 };\n            int[] attempts = new int[] { 0 };\n            boolean[] triedMobileFallback = new boolean[] { false };\n"""
)
replace_once(
    collector,
    """            final Runnable[] timeoutHolder = new Runnable[1];\n            timeoutHolder[0] = () -> finishError(main, null, webView, finished, callback, \"Authenticated source load timed out\");\n            main.postDelayed(timeoutHolder[0], TIMEOUT_MS);\n\n            final Runnable[] extractionRunner = new Runnable[1];\n            extractionRunner[0] = () -> {\n                if (finished.get()) return;\n                attempts[0]++;\n\n                webView.evaluateJavascript(extractionScript(url, targetLimit), value -> {\n                    if (finished.get()) return;\n                    try {\n""",
    """            final Runnable[] timeoutHolder = new Runnable[1];\n            timeoutHolder[0] = () -> {\n                Log.w(TAG, \"event=global_timeout attempts=\" + attempts[0] +\n                    \" progress=\" + webView.getProgress() + \" attached=\" + webView.isAttachedToWindow());\n                finishError(main, null, webView, finished, callback,\n                    \"COLLECTOR_TIMEOUT|attempts=\" + attempts[0] +\n                    \"|progress=\" + webView.getProgress() +\n                    \"|attached=\" + webView.isAttachedToWindow());\n            };\n            main.postDelayed(timeoutHolder[0], TIMEOUT_MS);\n\n            final Runnable[] extractionRunner = new Runnable[1];\n            extractionRunner[0] = () -> {\n                if (finished.get()) return;\n                if (!evaluationInFlight.compareAndSet(false, true)) return;\n                attempts[0]++;\n                final int generation = ++evaluationGeneration[0];\n                Log.i(TAG, \"event=extract_start attempt=\" + attempts[0] +\n                    \" progress=\" + webView.getProgress() + \" attached=\" + webView.isAttachedToWindow());\n\n                main.postDelayed(() -> {\n                    if (finished.get() || evaluationGeneration[0] != generation ||\n                        !evaluationInFlight.compareAndSet(true, false)) return;\n                    evaluationGeneration[0]++; // Invalidate a callback that arrives after this watchdog.\n                    Log.w(TAG, \"event=eval_watchdog attempt=\" + attempts[0] +\n                        \" progress=\" + webView.getProgress() + \" attached=\" + webView.isAttachedToWindow());\n\n                    if (attempts[0] >= SURFACE_FALLBACK_ATTEMPT) {\n                        if (!triedMobileFallback[0] && mobileUrl != null && !mobileUrl.equals(desktopUrl)) {\n                            triedMobileFallback[0] = true;\n                            attempts[0] = 0;\n                            Log.i(TAG, \"event=fallback surface=mobile\");\n                            webView.loadUrl(mobileUrl);\n                            main.postDelayed(extractionRunner[0], PAGE_STARTED_EXTRACTION_DELAY_MS);\n                            return;\n                        }\n                        if (!triedBasicFallback[0] && basicFallbackUrl != null &&\n                            !basicFallbackUrl.equals(desktopUrl) && !basicFallbackUrl.equals(mobileUrl)) {\n                            triedBasicFallback[0] = true;\n                            attempts[0] = 0;\n                            Log.i(TAG, \"event=fallback surface=basic\");\n                            webView.loadUrl(basicFallbackUrl);\n                            main.postDelayed(extractionRunner[0], PAGE_STARTED_EXTRACTION_DELAY_MS);\n                            return;\n                        }\n                    }\n\n                    if (attempts[0] >= MAX_EXTRACTION_ATTEMPTS) {\n                        finishError(main, timeoutHolder[0], webView, finished, callback,\n                            \"COLLECTOR_EVAL_TIMEOUT|attempts=\" + attempts[0] +\n                            \"|progress=\" + webView.getProgress() +\n                            \"|attached=\" + webView.isAttachedToWindow());\n                    } else {\n                        main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);\n                    }\n                }, EVALUATION_WATCHDOG_MS);\n\n                webView.evaluateJavascript(extractionScript(url, targetLimit), value -> {\n                    if (finished.get() || evaluationGeneration[0] != generation) return;\n                    evaluationInFlight.set(false);\n                    try {\n"""
)
replace_once(
    collector,
    """                                attempts[0] = 0;\n                                webView.loadUrl(mobileUrl);\n                                return;\n""",
    """                                attempts[0] = 0;\n                                Log.i(TAG, \"event=fallback surface=mobile\");\n                                webView.loadUrl(mobileUrl);\n                                main.postDelayed(extractionRunner[0], PAGE_STARTED_EXTRACTION_DELAY_MS);\n                                return;\n"""
)
replace_once(
    collector,
    """                                attempts[0] = 0;\n                                webView.loadUrl(basicFallbackUrl);\n                                return;\n""",
    """                                attempts[0] = 0;\n                                Log.i(TAG, \"event=fallback surface=basic\");\n                                webView.loadUrl(basicFallbackUrl);\n                                main.postDelayed(extractionRunner[0], PAGE_STARTED_EXTRACTION_DELAY_MS);\n                                return;\n"""
)
replace_once(
    collector,
    """                                webView.evaluateJavascript(\n                                    \"(() => { const h=Math.max(window.innerHeight||700,700); const max=Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0); window.scrollBy(0,Math.round(h*1.7)); if(window.scrollY+h>=max-80) window.scrollTo(0,max); return window.scrollY; })()\",\n                                    ignored -> main.postDelayed(extractionRunner[0], RETRY_DELAY_MS)\n                                );\n""",
    """                                webView.evaluateJavascript(\n                                    \"(() => { const h=Math.max(window.innerHeight||700,700); const max=Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0); window.scrollBy(0,Math.round(h*1.7)); if(window.scrollY+h>=max-80) window.scrollTo(0,max); return window.scrollY; })()\",\n                                    ignored -> { }\n                                );\n                                main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);\n"""
)
replace_once(
    collector,
    """                private void scheduleExtraction(long delayMs) {\n                    if (finished.get()) return;\n                    main.removeCallbacks(extractionRunner[0]);\n                    main.postDelayed(extractionRunner[0], delayMs);\n                }\n""",
    """                private void scheduleExtraction(long delayMs) {\n                    if (finished.get()) return;\n                    // Never cancel the independent poll loop. Some Android WebViews emit repeated\n                    // navigation callbacks while Facebook is hydrating, which previously kept\n                    // postponing the only extraction runnable until the global timeout fired.\n                    main.postDelayed(extractionRunner[0], delayMs);\n                }\n"""
)
replace_once(
    collector,
    """                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;\n                    // Facebook can keep network activity alive for a long time. Start DOM polling as\n""",
    """                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;\n                    Log.i(TAG, \"event=page_started progress=\" + view.getProgress() +\n                        \" attached=\" + view.isAttachedToWindow());\n                    // Facebook can keep network activity alive for a long time. Start DOM polling as\n"""
)
replace_once(
    collector,
    """                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;\n                    scheduleExtraction(180);\n                }\n            });\n\n            webView.loadUrl(desktopUrl);\n""",
    """                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;\n                    Log.i(TAG, \"event=page_finished progress=\" + view.getProgress() +\n                        \" attached=\" + view.isAttachedToWindow());\n                    scheduleExtraction(180);\n                }\n            });\n\n            Log.i(TAG, \"event=load_start attached=\" + webView.isAttachedToWindow());\n            webView.loadUrl(desktopUrl);\n            // Physical Android must not depend on WebViewClient callbacks to begin extraction.\n            main.postDelayed(extractionRunner[0], PAGE_STARTED_EXTRACTION_DELAY_MS);\n"""
)

# Update regression coverage for the new physical-host strategy and non-blocking startup gate.
test_file = "server/tests/architectureRegression.test.ts"
replace_once(
    test_file,
    "assert.match(host, /root\\.addView\\(webView, 0, params\\)/);",
    "assert.match(host, /root\\.addView\\(host, hostParams\\)/);\n  assert.match(host, /host\\.addView\\(webView, webParams\\)/);"
)
replace_once(
    test_file,
    """  assert.match(collector, /setOffscreenPreRaster\\(true\\)/);\n  assert.match(collector, /authority\\(\"www\\.facebook\\.com\"\\)/);\n""",
    """  assert.match(collector, /setOffscreenPreRaster\\(true\\)/);\n  assert.match(collector, /EVALUATION_WATCHDOG_MS/);\n  assert.match(collector, /evaluationInFlight/);\n  assert.match(collector, /authority\\(\"www\\.facebook\\.com\"\\)/);\n"""
)
replace_once(
    test_file,
    """  assert.match(gate, /stored === 'en'/);\n});\n""",
    """  assert.match(gate, /stored === 'en'/);\n  assert.match(gate, /const \\[checking, setChecking\\] = useState\\(false\\)/);\n});\n"""
)

print("PHYSICAL_ANDROID_FIX_APPLIED")
