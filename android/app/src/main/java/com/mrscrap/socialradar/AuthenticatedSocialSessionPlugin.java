package com.mrscrap.socialradar;

import android.content.Intent;
import android.webkit.CookieManager;

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
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AuthenticatedSocialSession")
public class AuthenticatedSocialSessionPlugin extends Plugin {
    private static final int MINIMUM_INTERVAL_MINUTES = 15;

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("connected", SessionStateStore.isFacebookConnected());
        result.put("connectedAt", SessionStateStore.connectedAt(getContext()));
        result.put("lastCheckedAt", SessionStateStore.lastCheckedAt(getContext()));
        result.put("message", SessionStateStore.isFacebookConnected()
            ? "Authenticated Facebook WebView session is available on this Android device."
            : "Facebook login is required on this Android device.");
        call.resolve(result);
    }

    @PluginMethod
    public void connectFacebook(PluginCall call) {
        Intent intent = new Intent(getContext(), FacebookSessionActivity.class);
        getActivity().startActivity(intent);
        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(success -> {
            cookieManager.flush();
            SessionStateStore.clear(getContext());
            WorkManager.getInstance(getContext()).cancelAllWorkByTag("mrscrap-authenticated-source");
            JSObject result = new JSObject();
            result.put("disconnected", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void resolveSource(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid Facebook/Instagram URL");
            return;
        }
        if (!SessionStateStore.isFacebookConnected()) {
            call.reject("Facebook session is not connected");
            return;
        }

        AuthenticatedWebCollector.collect(getContext(), url, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    JSONObject source = result.getJSONObject("source");
                    call.resolve(JSObject.fromJSONObject(source));
                } catch (Exception error) {
                    call.reject("Could not resolve authenticated source metadata");
                }
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void collectSource(PluginCall call) {
        String sourceId = call.getString("sourceId");
        String url = call.getString("url");
        if (sourceId == null || sourceId.isBlank()) {
            call.reject("sourceId is required");
            return;
        }
        if (url == null || !AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            call.reject("Invalid source URL");
            return;
        }
        if (!SessionStateStore.isFacebookConnected()) {
            call.reject("Facebook session is not connected");
            return;
        }

        AuthenticatedWebCollector.collect(getContext(), url, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                try {
                    SessionStateStore.markChecked(getContext());
                    JSObject output = new JSObject();
                    output.put("posts", result.getJSONArray("posts"));
                    output.put("checkedAt", java.time.Instant.now().toString());
                    call.resolve(output);
                } catch (Exception error) {
                    call.reject("Could not normalize collected posts");
                }
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void scheduleSource(PluginCall call) {
        String sourceId = call.getString("sourceId");
        String url = call.getString("url");
        String platform = call.getString("platform", "facebook");
        String backendBaseUrl = call.getString("backendBaseUrl");

        if (sourceId == null || sourceId.isBlank() || url == null || backendBaseUrl == null || backendBaseUrl.isBlank()) {
            call.reject("sourceId, url and backendBaseUrl are required");
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
            .build();

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            AuthenticatedSourceWorker.class,
            MINIMUM_INTERVAL_MINUTES,
            TimeUnit.MINUTES
        )
            .setInputData(input)
            .setConstraints(constraints)
            .addTag("mrscrap-authenticated-source")
            .addTag("mrscrap-source-" + sourceId)
            .build();

        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(
            uniqueWorkName(sourceId),
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );

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

    private static String uniqueWorkName(String sourceId) {
        return "mrscrap-auth-source-" + sourceId;
    }
}
