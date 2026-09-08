package com.mrscrap.socialradar;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores only the MR SCRAP backend device credential. Facebook cookies are owned by WebView's
 * CookieManager and never pass through this class.
 *
 * Ciphertext is stored in private SharedPreferences; the AES key is generated and retained by
 * AndroidKeyStore and is non-exportable.
 */
final class DeviceCredentialStore {
    private static final String PREFS = "mrscrap_backend_device_auth";
    private static final String CIPHERTEXT = "ciphertext";
    private static final String IV = "iv";
    private static final String KEY_ALIAS = "mrscrap_backend_device_auth_key_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";

    private DeviceCredentialStore() {}

    static synchronized void save(Context context, String userId, String deviceId, String token, String platform) throws Exception {
        if (token == null || token.length() < 24 || token.length() > 512) {
            throw new IllegalArgumentException("Invalid backend device token");
        }

        JSONObject payload = new JSONObject();
        payload.put("userId", userId == null ? "" : userId);
        payload.put("deviceId", deviceId == null ? "" : deviceId);
        payload.put("token", token);
        payload.put("platform", platform == null ? "android" : platform);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .apply();
    }

    static synchronized JSONObject read(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String ciphertextB64 = prefs.getString(CIPHERTEXT, null);
            String ivB64 = prefs.getString(IV, null);
            if (ciphertextB64 == null || ivB64 == null) return null;

            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            SecretKey key = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
            if (key == null) return null;

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                new GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP))
            );
            byte[] plaintext = cipher.doFinal(Base64.decode(ciphertextB64, Base64.NO_WRAP));
            JSONObject result = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
            String token = result.optString("token", "");
            if (token.length() < 24 || token.length() > 512) return null;
            return result;
        } catch (Exception error) {
            // Invalidated keys/corrupt ciphertext should force re-registration, not leak details.
            clear(context);
            return null;
        }
    }

    static synchronized String token(Context context) {
        JSONObject auth = read(context);
        return auth == null ? null : auth.optString("token", null);
    }

    static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        try {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {}
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
