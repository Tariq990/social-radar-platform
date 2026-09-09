package com.mrscrap.socialradar;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AuthenticatedSocialSession")
public class AuthenticatedSocialSessionPlugin extends Plugin {
    private static final int MINIMUM_INTERVAL_MINUTES = 15;
    private static final String FLOW_TAG = "MRSCRAP_FLOW";

    @PluginMethod
    public void status(PluginCall call) {
        boolean facebook = SessionStateStore.isFacebookConnected();
        boolean instagram = SessionStateStore.isInstagramConnected();
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("connected", facebook || instagram);
        result.put("facebookConnected", facebook);
        result.put("instagramConnected", instagram);
        result.put("facebookConnectedAt", SessionStateStore.facebookConnectedAt(getContext()));
        result.put("instagramConnectedAt", SessionStateStore.instagramConnectedAt(getContext()));
        result.put("connectedAt", SessionStateStore.connectedAt(getContext()));
        result.put("lastCheckedAt", SessionStateStore.lastCheckedAt(getContext()));
        result.put("message", facebook || instagram
            ? "Authenticated Meta session is available on this Android device."
            : "Connect Facebook or Instagram on this Android device.");
        call.resolve(result);
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        try {
            ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            JSObject result = new JSObject();
            if (clipboard == null || !clipboard.hasPrimaryClip()) {
                result.put("text", "");
                call.resolve(result);
                return;
            }
            ClipData clip = clipboard.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) {
                result.put("text", "");
                call.resolve(result);
                return;
            }
            CharSequence value = clip.getItemAt(0).coerceToText(getContext());
            result.put("text", value == null ? "" : value.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read clipboard");
        }
    }

    @PluginMethod
    public void connectFacebook(PluginCall call) {
        startActivityForResult(call, new Intent(getContext(), FacebookSessionActivity.class), "facebookSessionResult");
    }

    @PluginMethod
    public void connectInstagram(PluginCall call) {
        startActivityForResult(call, new Intent(getContext(), InstagramSessionActivity.class), "instagramSessionResult");
    }

    @ActivityCallback
    private void facebookSessionResult(PluginCall call, ActivityResult activityResult) {
        resolveSessionResult(call, activityResult, "facebook");
    }

    @ActivityCallback
    private void instagramSessionResult(PluginCall call, ActivityResult activityResult) {
        resolveSessionResult(call, activityResult, "instagram");
    }

    private void resolveSessionResult(PluginCall call, ActivityResult activityResult, String platform) {
        if (call == null) return;
        boolean connected = activityResult != null && activityResult.getResultCode() == Activity.RESULT_OK &&
            SessionStateStore.isConnectedForPlatform(platform);
        JSObject result = new JSObject();
        result.put("opened", true);
        result.put("platform", platform);
        result.put("connected", connected);
        result.put("cancelled", !connected);
        call.resolve(result);
    }

    @PluginMethod
    public void disconnectFacebook(PluginCall call) {
        expirePlatformCookies("facebook");
        SessionStateStore.clearFacebook(getContext());
        resolveDisconnect(call, "facebook");
    }

    @PluginMethod
    public void disconnectInstagram(PluginCall call) {
        expirePlatformCookies("instagram");
        SessionStateStore.clearInstagram(getContext());
        resolveDisconnect(call, "instagram");
    }

    /** Backward-compatible disconnect: clears only Meta sessions, never the MR SCRAP auth cookie. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        expirePlatformCookies("facebook");
        expirePlatformCookies("instagram");
        SessionStateStore.clear(getContext());
        WorkManager.getInstance(getContext()).cancelAllWorkByTag("mrscrap-authenticated-source");
        resolveDisconnect(call, "all");
    }

    private void resolveDisconnect(PluginCall call, String platform) {
        CookieManager.getInstance().flush();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject result = new JSObject();
            result.put("disconnected", true);
            result.put("platform", platform);
            result.put("facebookConnected", SessionStateStore.isFacebookConnected());
            result.put("instagramConnected", SessionStateStore.isInstagramConnected());
            call.resolve(result);
        }, 120);
    }

    private void expirePlatformCookies(String platform) {
        CookieManager manager = CookieManager.getInstance();
        String[] names;
        String base;
        String domain;
        if ("instagram".equals(platform)) {
            names = new String[] { "sessionid", "ds_user_id", "csrftoken", "rur", "mid", "ig_did" };
            base = "https://www.instagram.com/";
            domain = ".instagram.com";
        } else {
            names = new String[] { "c_user", "xs", "fr", "datr", "sb" };
            base = "https://www.facebook.com/";
            domain = ".facebook.com";
        }
        for (String name : names) {
            manager.setCookie(base, name + "=; Max-Age=0; Path=/; Domain=" + domain + "; Secure; SameSite=None");
            manager.setCookie(base, name + "=; Max-Age=0; Path=/; Secure; SameSite=None");
        }
    }

    @PluginMethod
    public void saveBackendAuth(PluginCall call) {
        try {
            DeviceCredentialStore.save(
                getContext(),
                call.getString("userId", ""),
                call.getString("deviceId", ""),
                call.getString("token"),
                call.getString("platform", "android")
            );
            JSObject result = new JSObject();
            result.put("saved", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not securely store backend device authorization");
        }
    }

    @PluginMethod
    public void getBackendAuth(PluginCall call) {
        JSONObject auth = DeviceCredentialStore.read(getContext());
        if (auth == null) {
            JSObject empty = new JSObject();
            empty.put("configured", false);
            call.resolve(empty);
            return;
        }
        try {
            JSObject result = JSObject.fromJSONObject(auth);
            result.put("configured", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read backend device authorization");
        }
    }

    @PluginMethod
    public void clearBackendAuth(PluginCall call) {
        DeviceCredentialStore.clear(getContext());
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    @PluginMethod
    public void resolveSource(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid Facebook/Instagram URL");
            return;
        }
        String platform = SessionStateStore.platformForUrl(url);
        if (!SessionStateStore.isConnectedForPlatform(platform)) {
            call.reject(("instagram".equals(platform) ? "Instagram" : "Facebook") + " session is not connected");
            return;
        }

        AuthenticatedSourceMetadataResolver.resolve(getContext(), url, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    call.resolve(JSObject.fromJSONObject(result.getJSONObject("source")));
                } catch (Exception error) {
                    call.reject("Could not resolve authenticated source metadata");
                }
            }
            @Override public void onError(String message) { call.reject(message); }
        });
    }

    @PluginMethod
    public void collectSource(PluginCall call) {
        String sourceId = call.getString("sourceId");
        String url = call.getString("url");
        Integer requestedLimit = call.getInt("limit", 10);
        int limit = requestedLimit == null ? 10 : Math.max(1, Math.min(20, requestedLimit));
        if (sourceId == null || sourceId.isBlank()) {
            call.reject("sourceId is required");
            return;
        }
        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid source URL");
            return;
        }
        String platform = SessionStateStore.platformForUrl(url);
        if (!SessionStateStore.isConnectedForPlatform(platform)) {
            call.reject(("instagram".equals(platform) ? "Instagram" : "Facebook") + " session is not connected");
            return;
        }

        Log.i(FLOW_TAG, "event=collect_source_enter platform=" + platform +
            " foreground=" + (getActivity() != null));

        AuthenticatedWebCollector.Callback terminal = terminalCollectCallback(call, platform, limit);
        if ("facebook".equals(platform)) {
            Log.i(FLOW_TAG, "event=collect_source_strategy platform=facebook primary=dom");
        }
        AuthenticatedWebCollector.collect(foregroundContext(), url, limit, terminal);
    }

    @PluginMethod
    public void collectPostDetails(PluginCall call) {
        String url = call.getString("url");
        String sourceUrl = call.getString("sourceUrl", "");
        String publisherName = call.getString("publisherName", "");
        String commentsMode = call.getString("commentsMode", "none");
        Integer requestedCommentLimit = call.getInt("commentLimit", 20);
        int commentLimit = requestedCommentLimit == null ? 20 : Math.max(1, Math.min(200, requestedCommentLimit));
        Boolean requestedReplies = call.getBoolean("includeReplies", true);
        boolean includeReplies = requestedReplies == null || requestedReplies;

        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid Facebook/Instagram post URL");
            return;
        }
        if (sourceUrl != null && !sourceUrl.isBlank() && !AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl)) {
            call.reject("Invalid Facebook/Instagram source URL");
            return;
        }
        String platform = SessionStateStore.platformForUrl(url);
        if (sourceUrl != null && !sourceUrl.isBlank() &&
            !platform.equalsIgnoreCase(SessionStateStore.platformForUrl(sourceUrl))) {
            call.reject("Post and source platforms do not match");
            return;
        }
        if (!SessionStateStore.isConnectedForPlatform(platform)) {
            call.reject(("instagram".equals(platform) ? "Instagram" : "Facebook") + " session is not connected");
            return;
        }

        AuthenticatedPostDetailCollector.collect(
            foregroundContext(),
            url,
            sourceUrl,
            publisherName,
            commentsMode,
            commentLimit,
            includeReplies,
            new AuthenticatedWebCollector.Callback() {
                @Override
                public void onSuccess(JSONObject result) {
                    try {
                        SessionStateStore.markChecked(getContext());
                        JSObject output = JSObject.fromJSONObject(result);
                        output.put("checkedAt", java.time.Instant.now().toString());
                        call.resolve(output);
                    } catch (Exception error) {
                        call.reject("Could not normalize collected post details");
                    }
                }
                @Override public void onError(String message) { call.reject(message); }
            }
        );
    }

    @PluginMethod
    public void scheduleSource(PluginCall call) {
        String sourceId = call.getString("sourceId");
        String url = call.getString("url");
        String platform = call.getString("platform", SessionStateStore.platformForUrl(url));
        String backendBaseUrl = call.getString("backendBaseUrl");
        String locale = "ar".equalsIgnoreCase(call.getString("locale", "en")) ? "ar" : "en";
        if (sourceId == null || sourceId.isBlank() || url == null || backendBaseUrl == null || backendBaseUrl.isBlank()) {
            call.reject("sourceId, url and backendBaseUrl are required");
            return;
        }
        if (DeviceCredentialStore.token(getContext()) == null) {
            call.reject("Backend device authorization is not stored on this Android device");
            return;
        }
        if (!AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid source URL");
            return;
        }

        Data input = new Data.Builder()
            .putString(AuthenticatedSourceWorker.KEY_SOURCE_ID, sourceId)
            .putString(AuthenticatedSourceWorker.KEY_SOURCE_URL, url)
            .putString(AuthenticatedSourceWorker.KEY_PLATFORM, platform)
            .putString(AuthenticatedSourceWorker.KEY_BACKEND_BASE_URL, backendBaseUrl)
            .putString(AuthenticatedSourceWorker.KEY_LOCALE, locale)
            .build();
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            AuthenticatedSourceWorker.class, MINIMUM_INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setInputData(input)
            .setConstraints(constraints)
            .addTag("mrscrap-authenticated-source")
            .addTag("mrscrap-source-" + sourceId)
            .build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(
            uniqueWorkName(sourceId), ExistingPeriodicWorkPolicy.UPDATE, request);

        JSObject result = new JSObject();
        result.put("scheduled", true);
        result.put("minimumIntervalMinutes", MINIMUM_INTERVAL_MINUTES);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelSource(PluginCall call) {
        String sourceId = call.getString("sourceId");
        if (sourceId == null || sourceId.isBlank()) {
            call.reject("sourceId is required");
            return;
        }
        WorkManager.getInstance(getContext()).cancelUniqueWork(uniqueWorkName(sourceId));
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }

    private AuthenticatedWebCollector.Callback terminalCollectCallback(PluginCall call, String platform, int limit) {
        return new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    int postCount = result.optJSONArray("posts") == null ? 0 : result.optJSONArray("posts").length();
                    Log.i(FLOW_TAG, "event=collect_source_success platform=" + platform + " posts=" + postCount);
                    SessionStateStore.markChecked(getContext());
                    JSObject output = new JSObject();
                    output.put("posts", result.getJSONArray("posts"));
                    output.put("checkedAt", java.time.Instant.now().toString());
                    output.put("requestedLimit", limit);
                    call.resolve(output);
                } catch (Exception error) {
                    Log.w(FLOW_TAG, "event=collect_source_error platform=" + platform + " code=NORMALIZE_ERROR");
                    call.reject("Could not normalize collected posts");
                }
            }

            @Override
            public void onError(String message) {
                Log.w(FLOW_TAG, "event=collect_source_error platform=" + platform + " code=" + safeErrorCode(message));
                call.reject(message);
            }
        };
    }

    private Context foregroundContext() {
        Activity activity = getActivity();
        return activity != null ? activity : getContext();
    }

    private static boolean shouldFallbackFromFacebookGraphql(String code) {
        return code != null && code.startsWith("GRAPHQL_");
    }

    private static String safeErrorCode(String message) {
        if (message == null || message.isBlank()) return "unknown";
        String code = message.split("\\|", 2)[0];
        String safe = code.replaceAll("[^A-Za-z0-9_.:-]", "_");
        return safe.substring(0, Math.min(80, safe.length()));
    }

    private static String uniqueWorkName(String sourceId) {
        return "mrscrap-auth-source-" + sourceId;
    }
}
