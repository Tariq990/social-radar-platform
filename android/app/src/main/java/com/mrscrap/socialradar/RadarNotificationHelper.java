package com.mrscrap.socialradar;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** Local Android notifications for new matches discovered by the authenticated device worker. */
final class RadarNotificationHelper {
    static final String CHANNEL_ID = "mrscrap_radar_alerts";

    private RadarNotificationHelper() {}

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "MR SCRAP Radar Alerts",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Alerts for posts that match your MR SCRAP watch rules");
        manager.createNotificationChannel(channel);
    }

    static boolean canNotify(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static void notifyMatches(Context context, JSONArray matches, String locale) {
        if (matches == null || matches.length() == 0) return;
        ensureChannel(context);
        if (!canNotify(context)) return;

        int count = matches.length();
        JSONObject first = matches.optJSONObject(0);
        String source = first == null ? "" : first.optString("sourceName", first.optString("source_name", ""));
        String reason = first == null ? "" : first.optString("reason", "");
        boolean arabic = "ar".equalsIgnoreCase(locale);
        String title;
        if (count == 1 && !source.isBlank()) title = source;
        else title = arabic ? count + " تنبيهات جديدة" : count + " new radar alerts";
        String body = !reason.isBlank()
            ? reason
            : (arabic ? "ظهر محتوى جديد يطابق إحدى قواعد المراقبة." : "New content matched one of your watch rules.");

        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(Intent.ACTION_VIEW);
        launch.setData(android.net.Uri.parse("mrscrap://alerts"));
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            1001,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setNumber(count);

        try {
            NotificationManagerCompat.from(context).notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
        } catch (SecurityException ignored) {
            // Permission can be revoked between the check and notify call.
        }
    }
}
