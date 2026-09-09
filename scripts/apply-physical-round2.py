from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:140]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, got {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Always paint a branded shell before React/CSS/network work, and never let remote fonts block
# the first frame of the bundled Android WebView.
replace_once(
    "index.html",
    '''    <!-- Fonts: Inter & Cairo for Arabic RTL rendering -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
''',
    '''    <!-- Remote fonts are progressive enhancement only. Never block the native first paint. -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
    <noscript><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
'''
)
replace_once(
    "index.html",
    '    <div id="root"></div>',
    '''    <div id="root">
      <div id="mrscrap-boot-shell" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#020617;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <div style="display:flex;align-items:center;gap:12px;font-size:14px;font-weight:800;letter-spacing:.04em"><span style="width:22px;height:22px;border:3px solid #155e75;border-top-color:#22d3ee;border-radius:999px"></span><span>MR SCRAP</span></div>
      </div>
    </div>'''
)

# 2) On native Android, never serialize the whole app shell behind a remote /auth/me request.
# The backend remains authoritative for all data/actions; anonymous responses still replace the shell.
replace_once(
    "src/App.tsx",
    "import React, { useState, useEffect } from 'react';",
    "import React, { useState, useEffect } from 'react';\nimport { Capacitor } from '@capacitor/core';"
)
replace_once(
    "src/App.tsx",
    "const RadarAppContent: React.FC = () => {",
    "const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';\n\nconst RadarAppContent: React.FC = () => {"
)
replace_once(
    "src/App.tsx",
    "  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');",
    "  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'anonymous'>(() => isNativeAndroid() ? 'authenticated' : 'checking');"
)
replace_once(
    "src/App.tsx",
    """      .catch(() => {
        if (!cancelled) setAuthState('anonymous');
      });
""",
    """      .catch(() => {
        // Network/cold-start failures must not blank a native shell. Protected API calls still
        // enforce the server session, while a definitive anonymous response above switches to auth.
        if (!cancelled && !isNativeAndroid()) setAuthState('anonymous');
      });
"""
)

# Deduplicate /auth/me between App and RadarProvider and bound cold-backend waits.
replace_once(
    "src/services/api.ts",
    "let registrationPromise: Promise<ApiDeviceAuthSession> | null = null;",
    "let registrationPromise: Promise<ApiDeviceAuthSession> | null = null;\nlet authSessionPromise: Promise<AppAuthSessionResponse> | null = null;"
)
replace_once(
    "src/services/api.ts",
    """export async function apiGetAuthSession(): Promise<AppAuthSessionResponse> {
  return requestJson<AppAuthSessionResponse>('/api/auth/me');
}
""",
    """export async function apiGetAuthSession(): Promise<AppAuthSessionResponse> {
  if (authSessionPromise) return authSessionPromise;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 6_000);
  authSessionPromise = requestJson<AppAuthSessionResponse>('/api/auth/me', { signal: controller.signal })
    .catch(error => {
      if (error instanceof ApiRequestError && error.status === 401) {
        return { authenticated: false, user: null } as AppAuthSessionResponse;
      }
      throw error;
    })
    .finally(() => {
      globalThis.clearTimeout(timeout);
      authSessionPromise = null;
    });
  return authSessionPromise;
}
"""
)

# 3) Give the foreground collector a materially visible compositor intersection during collection.
# 1x1 physically failed on the target device. 48 physical pixels is still a tiny clipped surface.
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/ForegroundWebViewHost.java",
    "FrameLayout.LayoutParams hostParams = new FrameLayout.LayoutParams(1, 1);\n        hostParams.gravity = Gravity.TOP | Gravity.START;\n        // Keep one physical pixel topmost so Surface/WebView visibility accounting cannot mark the\n        // collector fully occluded, while clipping all Facebook/Instagram pixels from the user.",
    "FrameLayout.LayoutParams hostParams = new FrameLayout.LayoutParams(48, 48);\n        hostParams.gravity = Gravity.BOTTOM | Gravity.END;\n        // The 1x1 intersection still produced an empty physical Facebook feed. Keep a tiny but\n        // material topmost intersection while retaining a full-size child layout/JS viewport."
)

# 4) Add structural flow telemetry only: no URLs, cookies, tokens, DOM text, or post text.
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    "import android.os.Looper;\nimport android.webkit.CookieManager;",
    "import android.os.Looper;\nimport android.util.Log;\nimport android.webkit.CookieManager;"
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    "public class AuthenticatedSocialSessionPlugin extends Plugin {\n    private static final int MINIMUM_INTERVAL_MINUTES = 15;",
    "public class AuthenticatedSocialSessionPlugin extends Plugin {\n    private static final int MINIMUM_INTERVAL_MINUTES = 15;\n    private static final String FLOW_TAG = \"MRSCRAP_FLOW\";"
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    """        AuthenticatedWebCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    SessionStateStore.markChecked(getContext());
""",
    """        Log.i(FLOW_TAG, \"event=collect_source_enter platform=\" + platform +
            \" foreground=\" + (getActivity() != null));
        AuthenticatedWebCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    int postCount = result.optJSONArray(\"posts\") == null ? 0 : result.optJSONArray(\"posts\").length();
                    Log.i(FLOW_TAG, \"event=collect_source_success platform=\" + platform + \" posts=\" + postCount);
                    SessionStateStore.markChecked(getContext());
"""
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    "            @Override public void onError(String message) { call.reject(message); }\n        });\n    }\n\n    @PluginMethod\n    public void collectPostDetails",
    "            @Override public void onError(String message) {\n                Log.w(FLOW_TAG, \"event=collect_source_error platform=\" + platform + \" code=\" + safeErrorCode(message));\n                call.reject(message);\n            }\n        });\n    }\n\n    @PluginMethod\n    public void collectPostDetails"
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    """    private static String uniqueWorkName(String sourceId) {
        return "mrscrap-auth-source-" + sourceId;
    }
}""",
    """    private static String safeErrorCode(String message) {
        if (message == null || message.isBlank()) return "unknown";
        String code = message.split("\\|", 2)[0];
        return code.replaceAll("[^A-Za-z0-9_.:-]", "_").substring(0, Math.min(80, code.length()));
    }

    private static String uniqueWorkName(String sourceId) {
        return "mrscrap-auth-source-" + sourceId;
    }
}"""
)

replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java",
    """                        boolean reliableSource = errorCode.isBlank() && source != null &&
                            isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);

                        if (reliableSource && postCount >= targetLimit) {
""",
    """                        boolean reliableSource = errorCode.isBlank() && source != null &&
                            isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);
                        JSONObject diagnostics = result.optJSONObject("diagnostics");
                        String surface = diagnostics == null ? "unknown" : diagnostics.optString("surface", "unknown").replaceAll("[^A-Za-z0-9._-]", "");
                        int containers = diagnostics == null ? 0 : diagnostics.optInt("containers", 0);
                        int anchors = diagnostics == null ? 0 : diagnostics.optInt("anchors", 0);
                        int postLinks = diagnostics == null ? 0 : diagnostics.optInt("postLinks", 0);
                        int bodyLength = diagnostics == null ? 0 : diagnostics.optInt("bodyTextLength", 0);
                        Log.i(TAG, "event=eval_result attempt=" + attempts[0] + " posts=" + postCount +
                            " reliable=" + reliableSource + " surface=" + surface + " containers=" + containers +
                            " anchors=" + anchors + " postLinks=" + postLinks + " body=" + bodyLength);

                        if (reliableSource && postCount >= targetLimit) {
"""
)
replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java",
    """                            if (postCount == 0 && !result.optBoolean("explicitEmptyState", false)) {
                                finishError(main, timeoutHolder[0], webView, finished, callback, noPostsDiagnostic(result));
                            } else {
""",
    """                            if (postCount == 0 && !result.optBoolean("explicitEmptyState", false)) {
                                String diagnostic = noPostsDiagnostic(result);
                                Log.w(TAG, "event=no_posts " + diagnostic);
                                finishError(main, timeoutHolder[0], webView, finished, callback, diagnostic);
                            } else {
"""
)

# Regression coverage for the physical findings.
replace_once(
    "server/tests/androidPhysicalRegression.test.ts",
    "assert.match(host, /new FrameLayout\\.LayoutParams\\(1, 1\\)/);",
    "assert.match(host, /new FrameLayout\\.LayoutParams\\(48, 48\\)/);"
)
replace_once(
    "server/tests/androidPhysicalRegression.test.ts",
    """  assert.match(collector, /main\\.postDelayed\\(extractionRunner\\[0\\], PAGE_STARTED_EXTRACTION_DELAY_MS\\)/);
});

""",
    """  assert.match(collector, /main\\.postDelayed\\(extractionRunner\\[0\\], PAGE_STARTED_EXTRACTION_DELAY_MS\\)/);
  assert.match(collector, /event=eval_result/);
  assert.match(collector, /event=no_posts/);

  const plugin = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java');
  assert.match(plugin, /MRSCRAP_FLOW/);
  assert.match(plugin, /event=collect_source_enter/);
});

test('native startup paints before remote fonts or auth network complete', () => {
  const index = read('index.html');
  const app = read('src/App.tsx');
  const api = read('src/services/api.ts');
  assert.match(index, /id="mrscrap-boot-shell"/);
  assert.match(index, /media="print" onload="this.media='all'"/);
  assert.match(app, /isNativeAndroid\\(\\) \\? 'authenticated' : 'checking'/);
  assert.match(api, /authSessionPromise/);
  assert.match(api, /6_000/);
});

"""
)
