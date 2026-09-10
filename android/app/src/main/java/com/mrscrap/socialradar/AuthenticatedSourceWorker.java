package com.mrscrap.socialradar;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class AuthenticatedSourceWorker extends Worker {
    public static final String KEY_SOURCE_ID = "sourceId";
    public static final String KEY_SOURCE_URL = "sourceUrl";
    public static final String KEY_PLATFORM = "platform";
    public static final String KEY_BACKEND_BASE_URL = "backendBaseUrl";
    public static final String KEY_LOCALE = "locale";

    // AuthenticatedWebCollector has a 75 second terminal timeout. The worker must remain alive
    // longer than that so it never returns RETRY while the collector WebView is still running.
    private static final long COLLECTOR_WAIT_SECONDS = 85;

    private static final class HttpResult {
        final int status;
        final String body;
        HttpResult(int status, String body) {
            this.status = status;
            this.body = body == null ? "" : body;
        }
    }

    public AuthenticatedSourceWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String sourceId = getInputData().getString(KEY_SOURCE_ID);
        String sourceUrl = getInputData().getString(KEY_SOURCE_URL);
        String platform = getInputData().getString(KEY_PLATFORM);
        // Never trust a backend URL persisted from JavaScript/WorkManager input when attaching the
        // backend device bearer. The destination is compiled into this APK from the trusted build
        // configuration, so a compromised WebView cannot redirect normalized ingestion elsewhere.
        String backendBaseUrl = BuildConfig.MR_SCRAP_BACKEND_ORIGIN;
        String locale = "ar".equalsIgnoreCase(getInputData().getString(KEY_LOCALE)) ? "ar" : "en";
        String authToken = DeviceCredentialStore.token(getApplicationContext());

        if (sourceId == null || sourceUrl == null || backendBaseUrl == null || backendBaseUrl.isBlank()) {
            return Result.failure(errorData("Missing worker configuration"));
        }
        if (authToken == null || authToken.length() < 24 || authToken.length() > 512) {
            return Result.failure(errorData("Backend device authorization is missing; reopen the app to re-register this device"));
        }
        if (!AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) || !isAllowedBackendUrl(backendBaseUrl)) {
            return Result.failure(errorData("Invalid source/backend URL"));
        }

        String derivedPlatform = SessionStateStore.platformForUrl(sourceUrl);
        if (derivedPlatform.isBlank()) {
            return Result.failure(errorData("Could not determine source platform"));
        }
        if (platform != null && !platform.isBlank() && !derivedPlatform.equalsIgnoreCase(platform)) {
            return Result.failure(errorData("Worker source platform does not match source URL"));
        }
        platform = derivedPlatform;
        if (!SessionStateStore.isConnectedForPlatform(platform)) {
            return Result.failure(errorData(("instagram".equalsIgnoreCase(platform) ? "Instagram" : "Facebook") + " session requires reconnect"));
        }

        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<JSONObject> collected = new AtomicReference<>();
        AtomicReference<String> collectionError = new AtomicReference<>();
        AuthenticatedWebCollector.collect(getApplicationContext(), sourceUrl, new AuthenticatedWebCollector.Callback() {
            @Override public void onSuccess(JSONObject result) { collected.set(result); latch.countDown(); }
            @Override public void onError(String message) { collectionError.set(message); latch.countDown(); }
        });

        try {
            if (!latch.await(COLLECTOR_WAIT_SECONDS, TimeUnit.SECONDS)) return Result.retry();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Result.retry();
        }
        if (collectionError.get() != null) return Result.failure(errorData(collectionError.get()));

        try {
            JSONObject collectedResult = collected.get();
            JSONArray posts = collectedResult != null ? collectedResult.optJSONArray("posts") : new JSONArray();
            if (posts == null) posts = new JSONArray();
            JSONObject payload = new JSONObject();
            payload.put("sourceId", sourceId);
            payload.put("posts", posts);
            payload.put("locale", locale);

            HttpResult response = postNormalizedData(backendBaseUrl, authToken, payload);
            if (response.status >= 200 && response.status < 300) {
                SessionStateStore.markChecked(getApplicationContext());
                JSONArray matches = new JSONArray();
                try {
                    JSONObject body = response.body.isBlank() ? new JSONObject() : new JSONObject(response.body);
                    JSONArray parsed = body.optJSONArray("matchesCreated");
                    if (parsed != null) matches = parsed;
                } catch (Exception ignored) {
                    // Successful ingestion remains valid even if a proxy strips or changes the response body.
                }
                RadarNotificationHelper.notifyMatches(getApplicationContext(), matches, locale);
                return Result.success(new Data.Builder()
                    .putInt("postCount", posts.length())
                    .putInt("matchCount", matches.length())
                    .putString("checkedAt", java.time.Instant.now().toString())
                    .build());
            }
            if (response.status == 401 || response.status == 403) {
                DeviceCredentialStore.clear(getApplicationContext());
                return Result.failure(errorData("Backend device authorization was rejected; reopen the app to re-register this device"));
            }
            if (response.status == 408 || response.status == 429 || response.status >= 500) return Result.retry();
            return Result.failure(errorData("Backend rejected normalized ingestion with HTTP " + response.status));
        } catch (Exception error) {
            return Result.retry();
        }
    }

    private HttpResult postNormalizedData(String backendBaseUrl, String authToken, JSONObject payload) throws Exception {
        String base = backendBaseUrl.replaceAll("/+$", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + "/api/device/ingest").openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-MR-SCRAP-CLIENT", "android-device-session");
        connection.setRequestProperty("Authorization", "Bearer " + authToken);
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }

        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder body = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (body.length() < 256 * 1024) body.append(line);
                }
            }
        }
        connection.disconnect();
        return new HttpResult(status, body.toString());
    }

    private boolean isAllowedBackendUrl(String raw) {
        try {
            URL url = new URL(raw);
            if (!"https".equalsIgnoreCase(url.getProtocol())) {
                return "http".equalsIgnoreCase(url.getProtocol()) &&
                    ("10.0.2.2".equals(url.getHost()) || "localhost".equalsIgnoreCase(url.getHost()));
            }
            return url.getHost() != null && !url.getHost().isBlank();
        } catch (Exception ignored) { return false; }
    }

    private Data errorData(String message) {
        return new Data.Builder().putString("error", message).build();
    }
}
