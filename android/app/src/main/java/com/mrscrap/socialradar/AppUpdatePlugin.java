package com.mrscrap.socialradar;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final long MAX_APK_BYTES = 30L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        JSObject result = new JSObject();
        result.put("versionCode", BuildConfig.VERSION_CODE);
        result.put("versionName", BuildConfig.VERSION_NAME);
        result.put("canInstallPackages", canInstallPackages());
        call.resolve(result);
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String rawUrl = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        Integer versionCode = call.getInt("versionCode");

        if (rawUrl == null || expectedSha256 == null || versionCode == null || versionCode < 1) {
            call.reject("url, sha256 and versionCode are required");
            return;
        }
        if (!expectedSha256.matches("(?i)^[a-f0-9]{64}$")) {
            call.reject("Invalid APK SHA-256");
            return;
        }

        try {
            URL parsed = new URL(rawUrl);
            if (!"https".equalsIgnoreCase(parsed.getProtocol())) {
                call.reject("Update download must use HTTPS");
                return;
            }
        } catch (Exception error) {
            call.reject("Invalid update URL");
            return;
        }

        if (!canInstallPackages()) {
            openInstallPermissionSettings();
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("permissionRequired", true);
            call.resolve(result);
            return;
        }

        final String downloadUrl = rawUrl;
        final String sha256 = expectedSha256.toLowerCase(Locale.US);
        final int targetVersionCode = versionCode;
        executor.execute(() -> downloadAndLaunchInstaller(call, downloadUrl, sha256, targetVersionCode));
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        getActivity().startActivity(intent);
    }

    private void downloadAndLaunchInstaller(
        PluginCall call,
        String downloadUrl,
        String expectedSha256,
        int targetVersionCode
    ) {
        HttpURLConnection connection = null;
        File partial = null;
        try {
            URL url = new URL(downloadUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", APK_MIME);
            connection.setRequestProperty("User-Agent", "MR-SCRAP-Android-Updater/1");

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("Update download failed with HTTP " + status);
            }
            URL finalUrl = connection.getURL();
            if (finalUrl == null || !"https".equalsIgnoreCase(finalUrl.getProtocol())) {
                throw new IllegalStateException("Update download redirected to a non-HTTPS URL");
            }

            long announcedLength = connection.getContentLengthLong();
            if (announcedLength > MAX_APK_BYTES) {
                throw new IllegalStateException("Update APK is too large");
            }

            File updateDir = new File(getContext().getCacheDir(), "updates");
            if (!updateDir.exists() && !updateDir.mkdirs()) {
                throw new IllegalStateException("Could not create update cache directory");
            }

            partial = new File(updateDir, "mr-scrap-" + targetVersionCode + ".apk.part");
            File target = new File(updateDir, "mr-scrap-" + targetVersionCode + ".apk");
            if (partial.exists()) partial.delete();
            if (target.exists()) target.delete();

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (
                BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                FileOutputStream output = new FileOutputStream(partial)
            ) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_APK_BYTES) {
                        throw new IllegalStateException("Update APK exceeds the maximum accepted size");
                    }
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }

            if (total < 1024) throw new IllegalStateException("Downloaded update APK is unexpectedly small");
            String actualSha256 = toHex(digest.digest());
            if (!actualSha256.equals(expectedSha256)) {
                throw new SecurityException("Downloaded APK SHA-256 verification failed");
            }

            if (!partial.renameTo(target)) {
                throw new IllegalStateException("Could not finalize downloaded APK");
            }

            Uri apkUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(apkUri, APK_MIME);
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(installer);
                    JSObject result = new JSObject();
                    result.put("started", true);
                    result.put("permissionRequired", false);
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("Android package installer could not be opened");
                }
            });
        } catch (Exception error) {
            if (partial != null && partial.exists()) partial.delete();
            String message = error.getMessage() == null ? "Update installation failed" : error.getMessage();
            getActivity().runOnUiThread(() -> call.reject(message));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.US, "%02x", value));
        return builder.toString();
    }
}
