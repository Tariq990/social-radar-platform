package com.mrscrap.socialradar;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Verifies a downloaded APK belongs to MR SCRAP and is signed by the currently installed signer. */
final class ApkIdentityVerifier {
    private ApkIdentityVerifier() {}

    static void verify(Context context, String apkPath, int expectedVersionCode) throws Exception {
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;

        PackageInfo installed = pm.getPackageInfo(context.getPackageName(), flags);
        PackageInfo archive = pm.getPackageArchiveInfo(apkPath, flags);
        if (archive == null) throw new SecurityException("Downloaded APK could not be inspected");
        if (!context.getPackageName().equals(archive.packageName)) {
            throw new SecurityException("Downloaded APK package identity does not match MR SCRAP");
        }

        long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? installed.getLongVersionCode()
            : installed.versionCode;
        long archiveCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? archive.getLongVersionCode()
            : archive.versionCode;
        if (archiveCode != expectedVersionCode) {
            throw new SecurityException("Downloaded APK version does not match release metadata");
        }
        if (archiveCode <= installedCode) {
            throw new SecurityException("Downloaded APK is not newer than the installed build");
        }

        Set<String> installedSigners = signerDigests(installed);
        Set<String> archiveSigners = signerDigests(archive);
        if (installedSigners.isEmpty() || archiveSigners.isEmpty() || !installedSigners.equals(archiveSigners)) {
            throw new SecurityException("Downloaded APK signing certificate does not match the installed app");
        }
    }

    private static Set<String> signerDigests(PackageInfo info) throws Exception {
        Set<String> result = new HashSet<>();
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo == null) return result;
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null) return result;
        for (Signature signature : signatures) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            result.add(toHex(digest.digest(signature.toByteArray())));
        }
        return result;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.US, "%02x", value & 0xff));
        return builder.toString();
    }
}
