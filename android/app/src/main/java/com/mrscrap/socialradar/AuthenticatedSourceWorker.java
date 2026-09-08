package com.mrscrap.socialradar;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Best-effort periodic authenticated source checker.
 *
 * Android controls the exact execution time; the minimum WorkManager interval is 15 minutes.
 * The worker uses the local WebView CookieManager session only for page collection. Backend
 * ingestion is a separate HTTPS request containing normalized post data, never cookies.
 * The MR SCRAP backend bearer token is read from AndroidKeyStore-backed storage at runtime and
 * is never persisted in WorkManager input/output data.
 */
public class AuthenticatedSourceWorker extends Worker {
    public static final String KEY_SOURCE_ID = "sourceId";
    public static final String KEY_SOURCE_URL = "sourceUrl";
    public static final String KEY_PLATFORM = "platform";
    public static final String KEY_BACKEND_BASE_URL = "backendBaseUrl";

    public AuthenticatedSourceWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String sourceId = getInputData().getString(KEY_SOURCE_ID);
        String sourceUrl = getInputData().getString(KEY_SOURCE_URL);
        String backendBaseUrl = getInputData().getString(KEY_BACKEND_BASE_URL);
        String authToken = DeviceCredentialStore.token(getApplicationContext());

        if (sourceId == null || sourceUrl == null || backendBaseUrl == null) {
            return Result.failure(errorData("Missing worker configuration"));
        }
        if (authToken == null || authToken.length() < 24 || authToken.length() > 512) {
            return Result.failure(errorData("Backend device authorization is missing; reopen the app to re-register this device"));
        }
        if (!SessionStateStore.isFacebookConnected()) {
            return Result.failure(errorData("Facebook session requires reconnect"));
        }
        if (!AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) || !isAllowedBackendUrl(backendBaseUrl)) {
            return Result.failure(errorData("Invalid source/backend URL"));
        }

        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<JSONObject> collected = new AtomicReference<>();
        AtomicReference<String> collectionError = new AtomicReference<>();

        AuthenticatedWebCollector.collect(getApplicationContext(), sourceUrl, new AuthenticatedWebCollector.Callback() {
            @Override
            public void onSuccess(JSONObject result) {
                collected.set(result);
                latch.countDown();
            }

            @Override
            public void onError(String message) {
                collectionError.set(message);
                latch.countDown();
            }
        });

        try {
            if (!latch.await(35, TimeUnit.SECONDS)) {
                return Result.retry();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Result.retry();
        }

        if (collectionError.get() != null) {
            return Result.failure(errorData(collectionError.get()));
        }

        try {
            JSONObject collectedResult = collected.get();
            JSONArray posts = collectedResult != null ? collectedResult.optJSONArray("posts") : new JSONArray();
            if (posts == null) posts = new JSONArray();

            JSONObject payload = new JSONObject();
            payload.put("sourceId", sourceId);
            payload.put("posts", posts);

            int status = postNormalizedData(backendBaseUrl, authToken, payload);
            if (status >= 200 && status < 300) {
                SessionStateStore.markChecked(getApplicationContext());
                return Result.success(new Data.Builder()
                    .putInt("postCount", posts.length())
                    .putString("checkedAt", java.time.Instant.now().toString())
                    .build());
            }
            if (status == 401 || status == 403) {
                DeviceCredentialStore.clear(getApplicationContext());
                return Result.failure(errorData("Backend device authorization was rejected; reopen the app to re-register this device"));
            }
            if (status == 408 || status == 429 || status >= 500) return Result.retry();
            return Result.failure(errorData("Backend rejected normalized ingestion with HTTP " + status));
        } catch (Exception error) {
            return Result.retry();
        }
    }

    private int postNormalizedData(String backendBaseUrl, String authToken, JSONObject payload) throws Exception {
        String base = backendBaseUrl.replaceAll("/+$", "");
        URL endpoint = new URL(base + "/api/device/ingest");
        HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection();
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
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }

        int status = connection.getResponseCode();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
            status >= 400 ? connection.getErrorStream() : connection.getInputStream(),
            StandardCharsets.UTF_8
        ))) {
            while (reader.readLine() != null) { /* intentionally discarded */ }
        } catch (Exception ignored) {}
        connection.disconnect();
        return status;
    }

    private boolean isAllowedBackendUrl(String raw) {
        try {
            URL url = new URL(raw);
            if (!"https".equalsIgnoreCase(url.getProtocol())) {
                return "http".equalsIgnoreCase(url.getProtocol()) &&
                    ("10.0.2.2".equals(url.getHost()) || "localhost".equalsIgnoreCase(url.getHost()));
            }
            return url.getHost() != null && !url.getHost().isBlank();
        } catch (Exception ignored) {
            return false;
        }
    }

    private Data errorData(String message) {
        return new Data.Builder().putString("error", message).build();
    }
}
