package com.easvarafy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Broadcast notifications from the Easvarafy admin panel, without FCM:
 *
 *  - stores the per-install device id + Supabase URL/anon key (handed over by
 *    the web layer through {@link EasvarafyNotifyPlugin#configure})
 *  - {@link #pollOnce(Context)} calls the Supabase RPC
 *    fetch_device_notifications(p_device_id, p_since) and posts a native
 *    notification per new broadcast (BigPictureStyle when it has an image,
 *    tap opens the app at the broadcast's action_url)
 *  - every notification uses tag = broadcast id and id 0, exactly like FCM's
 *    own display code, so FCM / poller / realtime never show a duplicate.
 *
 * All network methods are blocking: call them off the main thread.
 */
public final class BroadcastNotifier {
    private static final String TAG = "EasvarafyNotify";
    public static final String CHANNEL_ID = "easvarafy_broadcast_channel";
    public static final String ACTION_OPEN = "com.easvarafy.app.OPEN_NOTIFICATION";
    public static final String EXTRA_ID = "easvarafy_notification_id";
    public static final String EXTRA_ACTION_URL = "easvarafy_action_url";

    private static final String PREFS = "easvarafy_notify";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_URL = "supabase_url";
    private static final String KEY_ANON = "anon_key";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_LAST_SINCE = "last_since";
    private static final String KEY_SEEN = "seen_ids";
    private static final String KEY_LAST_POLL = "last_poll_at";
    private static final int MAX_SEEN = 200;
    private static final Object LOCK = new Object();

    private BroadcastNotifier() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------
    // Device id + config
    // ------------------------------------------------------------------

    public static String getOrCreateDeviceId(Context ctx) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            String id = p.getString(KEY_DEVICE_ID, null);
            if (id != null && id.matches("^[A-Za-z0-9_-]{8,128}$")) return id;
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            StringBuilder sb = new StringBuilder("and_");
            for (byte b : bytes) sb.append(String.format(Locale.US, "%02x", b));
            id = sb.toString();
            p.edit().putString(KEY_DEVICE_ID, id).apply();
            return id;
        }
    }

    public static void configure(Context ctx, String supabaseUrl, String anonKey, boolean enabled) {
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor e = p.edit();
        if (!TextUtils.isEmpty(supabaseUrl) && supabaseUrl.startsWith("https://")) {
            e.putString(KEY_URL, supabaseUrl.replaceAll("/+$", ""));
        }
        if (!TextUtils.isEmpty(anonKey)) e.putString(KEY_ANON, anonKey);
        e.putBoolean(KEY_ENABLED, enabled);
        // First configuration: only broadcasts sent from now on pop up natively
        // (older ones are in the in-app inbox).
        if (!p.contains(KEY_LAST_SINCE)) e.putString(KEY_LAST_SINCE, isoNow(0));
        e.apply();
    }

    public static boolean isConfigured(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return p.getBoolean(KEY_ENABLED, false)
            && !TextUtils.isEmpty(p.getString(KEY_URL, null))
            && !TextUtils.isEmpty(p.getString(KEY_ANON, null));
    }

    public static long lastPollAt(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_POLL, 0L);
    }

    // ------------------------------------------------------------------
    // Seen set (dedupe across FCM / poller / realtime)
    // ------------------------------------------------------------------

    private static LinkedHashSet<String> readSeen(SharedPreferences p) {
        LinkedHashSet<String> set = new LinkedHashSet<>();
        String raw = p.getString(KEY_SEEN, "");
        if (!TextUtils.isEmpty(raw)) set.addAll(Arrays.asList(raw.split(",")));
        set.remove("");
        return set;
    }

    private static void writeSeen(SharedPreferences p, LinkedHashSet<String> set) {
        List<String> list = new ArrayList<>(set);
        if (list.size() > MAX_SEEN) list = list.subList(list.size() - MAX_SEEN, list.size());
        p.edit().putString(KEY_SEEN, TextUtils.join(",", list)).apply();
    }

    public static boolean isSeen(Context ctx, String id) {
        synchronized (LOCK) {
            return readSeen(prefs(ctx)).contains(id);
        }
    }

    public static void markSeen(Context ctx, List<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            LinkedHashSet<String> set = readSeen(p);
            for (String id : ids) {
                if (id != null && id.matches("^[0-9a-fA-F-]{36}$")) {
                    set.remove(id);
                    set.add(id);
                }
            }
            writeSeen(p, set);
        }
    }

    // ------------------------------------------------------------------
    // Notification
    // ------------------------------------------------------------------

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Pengumuman & rilis baru", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Pengumuman, story, dan info rilis baru dari tim Easvarafy");
        channel.enableVibration(true);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    public static boolean notificationsAllowed(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 33) {
            return ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    /** Posts one broadcast. Blocking (downloads the image). Returns false when already shown. */
    public static boolean show(Context ctx, String id, String title, String body, String imageUrl, String actionUrl) {
        if (TextUtils.isEmpty(id) || TextUtils.isEmpty(title)) return false;
        if (isSeen(ctx, id)) return false;
        markSeen(ctx, java.util.Collections.singletonList(id));
        if (!notificationsAllowed(ctx)) return false;
        ensureChannel(ctx);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(ACTION_OPEN);
        open.putExtra(EXTRA_ID, id);
        if (!TextUtils.isEmpty(actionUrl)) open.putExtra(EXTRA_ACTION_URL, actionUrl);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, id.hashCode(), open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL_ID)
            : new Notification.Builder(ctx);
        String text = body == null ? "" : body;
        builder
            .setSmallIcon(smallIcon(ctx))
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setColor(0xFF7C5CFF)
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_RECOMMENDATION);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setDefaults(Notification.DEFAULT_ALL);
        }

        Bitmap picture = TextUtils.isEmpty(imageUrl) ? null : downloadBitmap(imageUrl);
        if (picture != null) {
            builder.setLargeIcon(picture);
            Notification.BigPictureStyle style = new Notification.BigPictureStyle()
                .bigPicture(picture)
                .setBigContentTitle(title)
                .setSummaryText(text);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) style.showBigPictureWhenCollapsed(false);
            builder.setStyle(style);
        } else {
            builder.setStyle(new Notification.BigTextStyle().bigText(text).setBigContentTitle(title));
        }

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        try {
            nm.notify(id, 0, builder.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    private static int smallIcon(Context ctx) {
        int res = ctx.getResources().getIdentifier("ic_stat_easvarafy", "drawable", ctx.getPackageName());
        return res != 0 ? res : ctx.getApplicationInfo().icon;
    }

    private static Bitmap downloadBitmap(String url) {
        if (!url.startsWith("https://")) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setInstanceFollowRedirects(true);
            if (conn.getResponseCode() != 200) return null;
            byte[] data = readAll(conn.getInputStream(), 6 * 1024 * 1024);
            if (data == null) return null;
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= 1024 || bounds.outHeight / (sample * 2) >= 1024) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in, int max) throws java.io.IOException {
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int total = 0;
            int n;
            while ((n = input.read(buf)) != -1) {
                total += n;
                if (total > max) return null;
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    // ------------------------------------------------------------------
    // Supabase poll
    // ------------------------------------------------------------------

    private static String isoNow(long offsetMs) {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date(System.currentTimeMillis() + offsetMs));
    }

    private static String rpc(SharedPreferences p, String fn, JSONObject body) throws Exception {
        String base = p.getString(KEY_URL, null);
        String anon = p.getString(KEY_ANON, null);
        if (TextUtils.isEmpty(base) || TextUtils.isEmpty(anon)) return null;
        HttpURLConnection conn = (HttpURLConnection) new URL(base + "/rest/v1/rpc/" + fn).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            conn.setRequestProperty("apikey", anon);
            conn.setRequestProperty("Authorization", "Bearer " + anon);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, fn + " -> HTTP " + code);
                return null;
            }
            byte[] data = readAll(conn.getInputStream(), 2 * 1024 * 1024);
            return data == null ? null : new String(data, StandardCharsets.UTF_8);
        } finally {
            conn.disconnect();
        }
    }

    /** One poll cycle. Returns the number of notifications posted. Blocking. */
    public static int pollOnce(Context ctx) {
        if (!isConfigured(ctx)) return 0;
        SharedPreferences p = prefs(ctx);
        p.edit().putLong(KEY_LAST_POLL, System.currentTimeMillis()).apply();
        String deviceId = getOrCreateDeviceId(ctx);
        String since = p.getString(KEY_LAST_SINCE, isoNow(-60L * 60L * 1000L));
        int posted = 0;
        try {
            JSONObject body = new JSONObject();
            body.put("p_device_id", deviceId);
            body.put("p_since", since);
            body.put("p_limit", 20);
            String res = rpc(p, "fetch_device_notifications", body);
            if (res == null) return 0;
            JSONArray rows = new JSONArray(res);
            String newest = since;
            JSONArray delivered = new JSONArray();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                String id = row.optString("id", "");
                String createdAt = row.optString("created_at", "");
                if (!TextUtils.isEmpty(createdAt)) newest = createdAt;
                if (TextUtils.isEmpty(id) || !row.isNull("read_at")) continue;
                boolean shown = show(
                    ctx,
                    id,
                    row.optString("title", "Easvarafy"),
                    row.optString("body", ""),
                    row.isNull("image_url") ? null : row.optString("image_url", null),
                    row.isNull("action_url") ? null : row.optString("action_url", null));
                if (shown) posted++;
                delivered.put(id);
            }
            // created_at from PostgREST is an ISO timestamp with offset; it is
            // only ever passed back to Postgres, which parses it exactly.
            p.edit().putString(KEY_LAST_SINCE, newest).apply();
            if (delivered.length() > 0) {
                JSONObject ack = new JSONObject();
                ack.put("p_device_id", deviceId);
                ack.put("p_ids", delivered);
                rpc(p, "mark_notifications_delivered", ack);
            }
        } catch (Exception e) {
            Log.w(TAG, "poll failed: " + e.getMessage());
        }
        return posted;
    }
}
