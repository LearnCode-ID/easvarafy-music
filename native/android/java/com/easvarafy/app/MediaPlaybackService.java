package com.easvarafy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground media service for Easvarafy.
 *
 * Android WebView does NOT bridge the web Media Session API
 * (navigator.mediaSession) to the operating system the way Chrome does, so a
 * Capacitor app gets no media notification / lock-screen player for free.
 * This service owns a real {@link MediaSession} and posts a
 * {@link Notification.MediaStyle} notification, which is what Android uses to
 * render the Spotify-style player in the notification shade, quick settings
 * and lock screen, and to route Bluetooth / headset buttons.
 *
 * State comes from JavaScript through {@link EasvarafyMediaPlugin}; button
 * presses are sent back to JavaScript through the same plugin.
 */
public class MediaPlaybackService extends Service {
    private static final String TAG = "EasvarafyMedia";
    private static final String CHANNEL_ID = "easvarafy_playback_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final int ARTWORK_MAX_PX = 512;

    public static final String ACTION_PLAY = "com.easvarafy.app.media.PLAY";
    public static final String ACTION_PAUSE = "com.easvarafy.app.media.PAUSE";
    public static final String ACTION_NEXT = "com.easvarafy.app.media.NEXT";
    public static final String ACTION_PREV = "com.easvarafy.app.media.PREV";
    public static final String ACTION_REFRESH = "com.easvarafy.app.media.REFRESH";

    private static final long SUPPORTED_ACTIONS =
        PlaybackState.ACTION_PLAY |
        PlaybackState.ACTION_PAUSE |
        PlaybackState.ACTION_PLAY_PAUSE |
        PlaybackState.ACTION_STOP |
        PlaybackState.ACTION_SKIP_TO_NEXT |
        PlaybackState.ACTION_SKIP_TO_PREVIOUS |
        PlaybackState.ACTION_SEEK_TO;

    /** Snapshot of what the web player is doing. Written from JS, read by the service. */
    public static final class Snapshot {
        public String title = "";
        public String artist = "";
        public String album = "";
        public String artworkUrl = null;
        public boolean playing = false;
        public long positionMs = 0L;
        public long durationMs = 0L;
        public float speed = 1f;
        /** SystemClock.elapsedRealtime() at the moment positionMs was sampled. */
        public long sampledAt = 0L;

        Snapshot copy() {
            Snapshot s = new Snapshot();
            s.title = title;
            s.artist = artist;
            s.album = album;
            s.artworkUrl = artworkUrl;
            s.playing = playing;
            s.positionMs = positionMs;
            s.durationMs = durationMs;
            s.speed = speed;
            s.sampledAt = sampledAt;
            return s;
        }

        long currentPositionMs() {
            long pos = positionMs;
            if (playing && sampledAt > 0) {
                pos += (long) ((SystemClock.elapsedRealtime() - sampledAt) * speed);
            }
            if (durationMs > 0 && pos > durationMs) pos = durationMs;
            return Math.max(0L, pos);
        }
    }

    private static final Object LOCK = new Object();
    private static Snapshot latest = null;
    private static volatile MediaPlaybackService instance = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private Bitmap artwork;
    private String artworkUrlLoaded;
    private String artworkUrlLoading;
    private boolean inForeground = false;

    // ------------------------------------------------------------------
    // Static API used by EasvarafyMediaPlugin
    // ------------------------------------------------------------------

    /** Push a new state from JS. Starts the service the first time something plays. */
    public static void applySnapshot(Context context, Snapshot snapshot) {
        synchronized (LOCK) {
            latest = snapshot.copy();
        }
        MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.mainHandler.post(svc::render);
            return;
        }
        if (!snapshot.playing) {
            // Do not pop a notification just because a paused track was restored on launch.
            return;
        }
        Context app = context.getApplicationContext();
        Intent intent = new Intent(app, MediaPlaybackService.class).setAction(ACTION_REFRESH);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                app.startForegroundService(intent);
            } else {
                app.startService(intent);
            }
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException when started from background.
            Log.w(TAG, "Unable to start media service", e);
        }
    }

    /** Remove the media notification (no track loaded anymore). */
    public static void clear(Context context) {
        synchronized (LOCK) {
            latest = null;
        }
        MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.mainHandler.post(svc::shutdown);
        }
    }

    /** Transport request coming from the system Dynamic Island. */
    static void requestTransport(final String action, final long seekPosMs) {
        final MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.mainHandler.post(() -> svc.handleTransport(action, seekPosMs));
        } else {
            EasvarafyMediaPlugin.dispatchAction(action, seekPosMs >= 0 ? seekPosMs / 1000.0 : -1);
        }
    }

    /** Re-render the Dynamic Island (permission / setting changed). */
    static void refreshIsland() {
        final MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.mainHandler.post(svc::render);
        }
    }

    private static Snapshot readLatest() {
        synchronized (LOCK) {
            return latest == null ? null : latest.copy();
        }
    }

    /** Optimistically flip play/pause so the UI reacts instantly, JS will confirm. */
    private static void setLatestPlaying(boolean playing) {
        synchronized (LOCK) {
            if (latest == null) return;
            latest.positionMs = latest.currentPositionMs();
            latest.sampledAt = SystemClock.elapsedRealtime();
            latest.playing = playing;
        }
    }

    // ------------------------------------------------------------------
    // Service lifecycle
    // ------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Easvarafy::MediaPlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }

        session = new MediaSession(this, "Easvarafy");
        setLegacySessionFlags(session);
        session.setSessionActivity(openAppIntent());
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    handleTransport("play", -1);
                }

                @Override
                public void onPause() {
                    handleTransport("pause", -1);
                }

                @Override
                public void onStop() {
                    handleTransport("pause", -1);
                }

                @Override
                public void onSkipToNext() {
                    handleTransport("next", -1);
                }

                @Override
                public void onSkipToPrevious() {
                    handleTransport("previous", -1);
                }

                @Override
                public void onSeekTo(long pos) {
                    handleTransport("seekto", pos);
                }
            },
            mainHandler
        );
    }

    @SuppressWarnings("deprecation")
    private static void setLegacySessionFlags(MediaSession s) {
        // Always on since API 26; required for media buttons on API 24-25.
        s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForegroundService() requires startForeground() promptly, every time.
        render();

        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(action)) {
            handleTransport("play", -1);
        } else if (ACTION_PAUSE.equals(action)) {
            handleTransport("pause", -1);
        } else if (ACTION_NEXT.equals(action)) {
            handleTransport("next", -1);
        } else if (ACTION_PREV.equals(action)) {
            handleTransport("previous", -1);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        mainHandler.removeCallbacksAndMessages(null);
        DynamicIslandController.get(this).clear();
        artworkExecutor.shutdownNow();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        removeForeground();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------------
    // Transport controls -> JS
    // ------------------------------------------------------------------

    private void handleTransport(String action, long seekPosMs) {
        if ("play".equals(action)) {
            setLatestPlaying(true);
        } else if ("pause".equals(action)) {
            setLatestPlaying(false);
        } else if ("seekto".equals(action) && seekPosMs >= 0) {
            synchronized (LOCK) {
                if (latest != null) {
                    latest.positionMs = seekPosMs;
                    latest.sampledAt = SystemClock.elapsedRealtime();
                }
            }
        }
        render();
        EasvarafyMediaPlugin.dispatchAction(action, seekPosMs >= 0 ? seekPosMs / 1000.0 : -1);
    }

    // ------------------------------------------------------------------
    // Rendering: MediaSession + notification
    // ------------------------------------------------------------------

    private void render() {
        if (session == null) return;
        Snapshot s = readLatest();

        if (s == null) {
            // Started without a track (should be rare) – satisfy the FGS contract, then stop.
            startForegroundCompat(buildIdleNotification());
            shutdown();
            return;
        }

        ensureArtwork(s.artworkUrl);

        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, s.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, s.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, s.album);
        if (s.durationMs > 0) {
            meta.putLong(MediaMetadata.METADATA_KEY_DURATION, s.durationMs);
        }
        Bitmap art = s.artworkUrl != null && s.artworkUrl.equals(artworkUrlLoaded) ? artwork : null;
        if (art != null) {
            meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
            meta.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, art);
        }
        session.setMetadata(meta.build());

        PlaybackState state = new PlaybackState.Builder()
            .setActions(SUPPORTED_ACTIONS)
            .setState(
                s.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                s.currentPositionMs(),
                s.playing ? s.speed : 0f,
                SystemClock.elapsedRealtime()
            )
            .build();
        session.setPlaybackState(state);
        if (!session.isActive()) {
            session.setActive(true);
        }

        // System-wide Dynamic Island around the front camera (if enabled + permitted).
        DynamicIslandController.get(this).update(s, art);

        Notification notification = buildMediaNotification(s, art);
        if (!inForeground) {
            startForegroundCompat(notification);
        } else {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }

        if (wakeLock != null) {
            if (s.playing && !wakeLock.isHeld()) {
                wakeLock.acquire();
            } else if (!s.playing && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }

    private Notification buildMediaNotification(Snapshot s, Bitmap art) {
        Notification.Builder b = newBuilder()
            .setSmallIcon(R.drawable.ic_stat_easvarafy)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setContentIntent(openAppIntent())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(true);
        if (s.album != null && !s.album.isEmpty()) {
            b.setSubText(s.album);
        }
        if (art != null) {
            b.setLargeIcon(art);
        }

        b.addAction(action(android.R.drawable.ic_media_previous, "Sebelumnya", ACTION_PREV, 1));
        if (s.playing) {
            b.addAction(action(android.R.drawable.ic_media_pause, "Jeda", ACTION_PAUSE, 2));
        } else {
            b.addAction(action(android.R.drawable.ic_media_play, "Putar", ACTION_PLAY, 3));
        }
        b.addAction(action(android.R.drawable.ic_media_next, "Berikutnya", ACTION_NEXT, 4));

        b.setStyle(
            new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2)
        );
        return b.build();
    }

    private Notification buildIdleNotification() {
        return newBuilder()
            .setSmallIcon(R.drawable.ic_stat_easvarafy)
            .setContentTitle("Easvarafy")
            .setContentText("Siap memutar musik")
            .setContentIntent(openAppIntent())
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .build();
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder newBuilder() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(this, CHANNEL_ID);
        }
        return new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
    }

    private Notification.Action action(int icon, String title, String intentAction, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(intentAction);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            pi = PendingIntent.getForegroundService(this, requestCode, intent, piFlags);
        } else {
            pi = PendingIntent.getService(this, requestCode, intent, piFlags);
        }
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build();
    }

    private PendingIntent openAppIntent() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            this,
            0,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void startForegroundCompat(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            inForeground = true;
        } catch (Exception e) {
            Log.w(TAG, "startForeground failed", e);
        }
    }

    @SuppressWarnings("deprecation")
    private void removeForeground() {
        if (!inForeground) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        inForeground = false;
    }

    private void shutdown() {
        DynamicIslandController.get(this).clear();
        if (session != null) {
            session.setActive(false);
        }
        removeForeground();
        stopSelf();
    }

    // ------------------------------------------------------------------
    // Artwork
    // ------------------------------------------------------------------

    private void ensureArtwork(final String url) {
        if (url == null || url.isEmpty()) return;
        if (url.equals(artworkUrlLoaded) || url.equals(artworkUrlLoading)) return;
        artworkUrlLoading = url;
        try {
            artworkExecutor.execute(() -> {
                final Bitmap bmp = downloadBitmap(url);
                mainHandler.post(() -> {
                    if (!url.equals(artworkUrlLoading)) return;
                    artworkUrlLoading = null;
                    if (bmp == null) return;
                    artwork = bmp;
                    artworkUrlLoaded = url;
                    Snapshot s = readLatest();
                    if (s != null && url.equals(s.artworkUrl)) {
                        render();
                    }
                });
            });
        } catch (Exception e) {
            artworkUrlLoading = null;
        }
    }

    private static Bitmap downloadBitmap(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (conn.getResponseCode() >= 400) return null;
            Bitmap raw;
            try (InputStream in = conn.getInputStream()) {
                raw = BitmapFactory.decodeStream(in);
            }
            if (raw == null) return null;
            int w = raw.getWidth();
            int h = raw.getHeight();
            // YouTube video thumbnails (hqdefault) are 4:3 with the 16:9 frame letterboxed
            // inside – crop to a centred square of the real picture so no black bars show.
            int side = Math.min(w, h);
            if (Math.abs(w * 3 - h * 4) <= 4) {
                side = Math.max(1, Math.round(h * 0.75f));
            }
            Bitmap square = raw;
            if (w != h) {
                square = Bitmap.createBitmap(raw, (w - side) / 2, (h - side) / 2, side, side);
            }
            if (side > ARTWORK_MAX_PX) {
                square = Bitmap.createScaledBitmap(square, ARTWORK_MAX_PX, ARTWORK_MAX_PX, true);
            }
            return square;
        } catch (Exception e) {
            Log.w(TAG, "Artwork download failed", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ------------------------------------------------------------------

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Pemutaran Musik",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Kontrol musik di notifikasi dan layar kunci");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
