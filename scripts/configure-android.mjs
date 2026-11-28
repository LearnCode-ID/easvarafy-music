#!/usr/bin/env node
/**
 * Post-`cap add/sync android` configuration script.
 * Ensures the generated Capacitor Android project includes:
 *  1. Deep-link intent filter for `com.easvarafy.app://auth/callback` (Google OAuth PKCE).
 *  2. Native Android animated GIF splash screen (`public/loading.gif` -> `res/raw/loading.gif`).
 *  3. Permissions & Foreground Service (`mediaPlayback` + WakeLock + BackgroundWebView)
 *     so music continues playing smoothly when the user minimizes the app or locks the screen.
 *     The service owns a native MediaSession + MediaStyle notification (copied from
 *     native/android) so Android shows the Spotify-style player in the notification
 *     shade and on the lock screen. The WebView does not do this on its own.
 *  4. Adequate Gradle JVM heap (`-Xmx2048m`) for CI builds.
 *  5. Remote-hosted app (capacitor.config.ts `server.url`) with an offline
 *     safety net: OfflineWebViewClient serves the APK's bundled copy of the web
 *     app when there is no connection, serves downloaded songs with HTTP Range
 *     support, and MainActivity shows a native "no internet / retry" screen
 *     instead of Chrome's net::ERR_INTERNET_DISCONNECTED page.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configureAppLinks } from './android-app-links.mjs';

const root = process.cwd();
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePropsPath = path.join(root, 'android', 'gradle.properties');
const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'easvarafy', 'app');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');
const layoutDir = path.join(resDir, 'layout');
const rawDir = path.join(resDir, 'raw');
const valuesDir = path.join(resDir, 'values');
const valuesV31Dir = path.join(resDir, 'values-v31');

if (existsSync(manifestPath)) {
  let manifest = configureAppLinks(readFileSync(manifestPath, 'utf8'));

  if (!manifest.includes('android:scheme="com.easvarafy.app"')) {
    const deepLinkFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.easvarafy.app" android:host="auth" android:pathPrefix="/callback" />
            </intent-filter>`;

    const anchor = '</activity>';
    if (manifest.includes(anchor)) {
      manifest = manifest.replace(anchor, `${deepLinkFilter}\n        ${anchor}`);
      console.log('✓ Added com.easvarafy.app://auth/callback intent-filter to AndroidManifest.xml');
    } else {
      console.warn('! Could not locate </activity> in AndroidManifest.xml');
    }
  } else {
    console.log('· Deep-link intent-filter already present in AndroidManifest.xml');
  }

  // Register MediaPlaybackService for background audio
  if (!manifest.includes('android:name=".MediaPlaybackService"')) {
    const serviceTag = `
        <service
            android:name=".MediaPlaybackService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />`;
    if (manifest.includes('</application>')) {
      manifest = manifest.replace('</application>', `${serviceTag}\n    </application>`);
      console.log('✓ Registered MediaPlaybackService in AndroidManifest.xml');
    }
  }

  // System-wide Dynamic Island host (TYPE_ACCESSIBILITY_OVERLAY above the status bar,
  // around the front camera). Enabled by the user in Settings > Accessibility.
  if (!manifest.includes('android:name=".IslandAccessibilityService"')) {
    const islandService = `
        <service
            android:name=".IslandAccessibilityService"
            android:exported="true"
            android:label="@string/easvarafy_island_accessibility_label"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/easvarafy_island_accessibility" />
        </service>`;
    if (manifest.includes('</application>')) {
      manifest = manifest.replace('</application>', `${islandService}\n    </application>`);
      console.log('✓ Registered IslandAccessibilityService (Dynamic Island) in AndroidManifest.xml');
    }
  }

  // Background poller for admin broadcast notifications (works without FCM).
  if (!manifest.includes('android:name=".NotificationPollJobService"')) {
    const pollService = `
        <service
            android:name=".NotificationPollJobService"
            android:exported="false"
            android:permission="android.permission.BIND_JOB_SERVICE" />`;
    if (manifest.includes('</application>')) {
      manifest = manifest.replace('</application>', `${pollService}\n    </application>`);
      console.log('✓ Registered NotificationPollJobService in AndroidManifest.xml');
    }
  }

  // FCM-displayed notifications: same channel / icon / accent as the poller.
  if (!manifest.includes('com.google.firebase.messaging.default_notification_channel_id')) {
    const fcmMeta = `
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="easvarafy_broadcast_channel" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_easvarafy" />`;
    if (manifest.includes('</application>')) {
      manifest = manifest.replace('</application>', `${fcmMeta}\n    </application>`);
      console.log('✓ Added FCM default notification channel/icon meta-data');
    }
  }

  // Add required permissions for background media playback
  const requiredPermissions = [
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.POST_NOTIFICATIONS',
    // Offline detection (native retry screen / bundled offline app).
    'android.permission.ACCESS_NETWORK_STATE',
    // Fallback host for the Dynamic Island ("display over other apps").
    'android.permission.SYSTEM_ALERT_WINDOW',
    // Notification poller job survives reboots (JobInfo.setPersisted).
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.INTERNET',
  ];
  for (const perm of requiredPermissions) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(
        '</manifest>',
        `    <uses-permission android:name="${perm}" />\n</manifest>`
      );
      console.log(`✓ Added ${perm} to AndroidManifest.xml`);
    }
  }

  writeFileSync(manifestPath, manifest, 'utf8');
} else {
  console.warn('! AndroidManifest.xml not found at', manifestPath);
}

// Install native GIF splash asset into res/raw/loading.gif (and avoid duplicate in web assets)
const loadingGifSrc = path.join(root, 'public', 'loading.gif');
if (existsSync(loadingGifSrc)) {
  mkdirSync(rawDir, { recursive: true });
  copyFileSync(loadingGifSrc, path.join(rawDir, 'loading.gif'));
  const webLoadingCopy = path.join(
    root,
    'android',
    'app',
    'src',
    'main',
    'assets',
    'public',
    'loading.gif'
  );
  if (existsSync(webLoadingCopy)) {
    rmSync(webLoadingCopy, { force: true });
  }
  console.log('✓ Copied public/loading.gif to res/raw/loading.gif');
} else {
  console.warn('! public/loading.gif not found; native GIF splash will be skipped');
}

// Ensure launch window background matches #000000 for seamless transition into loading.gif
mkdirSync(valuesDir, { recursive: true });
mkdirSync(valuesV31Dir, { recursive: true });

writeFileSync(
  path.join(valuesDir, 'styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/black</item>
        <item name="android:navigationBarColor">@android:color/black</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@android:color/black</item>
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/black</item>
        <item name="android:navigationBarColor">@android:color/black</item>
    </style>
</resources>
`,
  'utf8'
);

writeFileSync(
  path.join(valuesV31Dir, 'styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowSplashScreenBackground">@android:color/black</item>
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/black</item>
        <item name="android:navigationBarColor">@android:color/black</item>
    </style>
</resources>
`,
  'utf8'
);

// Write BackgroundWebView, GifMovieView, MediaPlaybackService, MainActivity, and layout override
mkdirSync(javaDir, { recursive: true });
mkdirSync(layoutDir, { recursive: true });

writeFileSync(
  path.join(javaDir, 'BackgroundWebView.java'),
  `package com.easvarafy.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

public class BackgroundWebView extends CapacitorWebView {
    public BackgroundWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        // Keep Chromium WebView convinced the window remains visible so YouTube
        // IFrame and HTML5 audio playback are not suspended when minimized.
        super.onWindowVisibilityChanged(View.VISIBLE);
    }
}
`,
  'utf8'
);

writeFileSync(
  path.join(javaDir, 'GifMovieView.java'),
  `package com.easvarafy.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Movie;
import android.os.SystemClock;
import android.view.View;
import java.io.InputStream;

/**
 * Lightweight fallback GIF renderer for Android 7-8 (API 24-27), where
 * ImageDecoder / AnimatedImageDrawable is not yet available.
 */
@SuppressWarnings("deprecation")
public class GifMovieView extends View {
    private final Movie movie;
    private long movieStart = 0;

    public GifMovieView(Context context, int rawResId) {
        super(context);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        InputStream stream = context.getResources().openRawResource(rawResId);
        this.movie = Movie.decodeStream(stream);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (movie == null) return;

        long now = SystemClock.uptimeMillis();
        if (movieStart == 0) {
            movieStart = now;
        }
        int duration = movie.duration();
        if (duration <= 0) {
            duration = 2000;
        }
        int relTime = (int) ((now - movieStart) % duration);
        movie.setTime(relTime);

        int viewW = getWidth();
        int viewH = getHeight();
        int movieW = Math.max(1, movie.width());
        int movieH = Math.max(1, movie.height());
        float scale = Math.min((float) viewW / movieW, (float) viewH / movieH);
        float dx = (viewW - movieW * scale) / 2f;
        float dy = (viewH - movieH * scale) / 2f;

        canvas.save();
        canvas.translate(dx, dy);
        canvas.scale(scale, scale);
        movie.draw(canvas, 0f, 0f);
        canvas.restore();

        postInvalidateOnAnimation();
    }
}
`,
  'utf8'
);

// MediaPlaybackService (MediaSession + MediaStyle notification / lock-screen player)
// and the EasvarafyMedia Capacitor plugin live as real Java files in
// native/android so they are easy to read and edit.
const nativeAndroidDir = path.join(root, 'native', 'android');
const copyTree = (src, dest) => {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
};
copyTree(path.join(nativeAndroidDir, 'java'), path.join(root, 'android', 'app', 'src', 'main', 'java'));
copyTree(path.join(nativeAndroidDir, 'res'), resDir);
// Compile-time API allowlist for native transfers (no arbitrary URL bridge).
const downloadBase = process.env.NEXT_PUBLIC_API_BASE ||
  (/^https:\/\//.test(process.env.CAPACITOR_SERVER_URL || '') ? process.env.CAPACITOR_SERVER_URL : 'https://easvarafy-music.vercel.app');
const downloadOrigin = new URL(downloadBase).origin;
if (!downloadOrigin.startsWith('https://')) throw new Error('Native download API must use HTTPS');
mkdirSync(valuesDir, { recursive: true });
writeFileSync(path.join(valuesDir, 'easvarafy_download.xml'),
  `<resources><string name="easvarafy_download_origin" translatable="false">${downloadOrigin}</string></resources>`);

console.log('✓ Copied native/android (MediaPlaybackService, EasvarafyMediaPlugin, Dynamic Island, icons)');

writeFileSync(
  path.join(javaDir, 'MainActivity.java'),
  `package com.easvarafy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.graphics.drawable.AnimatedImageDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long MIN_SPLASH_MS = 2400L;
    private static final long MAX_SPLASH_MS = 6000L;

    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    private FrameLayout splashOverlay;
    private AnimatedImageDrawable splashAnimatedDrawable;
    private long splashStartTimeMs = 0L;
    private boolean splashDismissed = false;

    private static final int REQUEST_POST_NOTIFICATIONS = 4210;

    // Offline support (remote server.url + bundled offline copy)
    private final Handler offlineHandler = new Handler(Looper.getMainLooper());
    private OfflineWebViewClient offlineClient;
    private FrameLayout offlineOverlay;
    private TextView offlineTitle;
    private TextView offlineStatus;
    private boolean offlineOverlayVisible = false;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugin: native media notification + lock-screen controls.
        registerPlugin(EasvarafyMediaPlugin.class);
        // Local plugin: admin broadcast notifications (device id, poller, taps).
        registerPlugin(EasvarafyNotifyPlugin.class);
        registerPlugin(EasvarafyDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
        setupNotifications();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
        showNativeGifSplash();
        setupOfflineSupport();
        setupBackButton();
    }

    // ------------------------------------------------------------------
    // Back button
    // ------------------------------------------------------------------
    // The web app is a single-page app (tabs, detail pages and sheets are not
    // browser history), so Capacitor's default "goBack() if canGoBack()" did
    // nothing. Registered after super.onCreate(), this callback runs before the
    // App plugin's: it asks the page to close its topmost layer
    // (window.__easvarafyHandleBack, lib/native/backButton.ts) and otherwise
    // moves the app to the background so music keeps playing.

    private final Handler backHandler = new Handler(Looper.getMainLooper());
    private boolean backPending = false;

    private void setupBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackPressed();
            }
        });
    }

    private void handleBackPressed() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (offlineOverlayVisible || webView == null) {
            moveTaskToBack(true);
            return;
        }
        if (backPending) return;
        backPending = true;
        final boolean canGoBack = webView.canGoBack();
        // A hung renderer must never trap the user on this screen.
        final Runnable watchdog = () -> {
            if (!backPending) return;
            backPending = false;
            moveTaskToBack(true);
        };
        backHandler.postDelayed(watchdog, 1500L);
        String js = "(function(){try{if(typeof window.__easvarafyHandleBack!=='function')return 'none';"
            + "return window.__easvarafyHandleBack(" + canGoBack + ")?'handled':'exit';}catch(e){return 'none';}})()";
        try {
            webView.evaluateJavascript(js, value -> {
                if (!backPending) return; // watchdog already acted
                backPending = false;
                backHandler.removeCallbacks(watchdog);
                if (value != null && value.contains("handled")) return;
                if (value != null && value.contains("none") && canGoBack) {
                    // Page without the handler (loading, offline page, old web build).
                    webView.goBack();
                    return;
                }
                moveTaskToBack(true);
            });
        } catch (Exception e) {
            backPending = false;
            backHandler.removeCallbacks(watchdog);
            if (canGoBack) webView.goBack();
            else moveTaskToBack(true);
        }
    }

    // ------------------------------------------------------------------
    // Offline: native retry screen + bundled offline app
    // ------------------------------------------------------------------

    private void setupOfflineSupport() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        offlineClient = new OfflineWebViewClient(this.bridge, description -> showOfflineScreen());
        this.bridge.setWebViewClient(offlineClient);
        WebView webView = this.bridge.getWebView();
        // The first navigation was only queued by Capacitor (main thread has not
        // yielded yet), so re-issue it through the offline-aware client.
        webView.stopLoading();
        if (!NetworkState.isOnline(this) && !NetworkState.hasOfflineDownloads(this)) {
            showOfflineScreen();
        } else {
            // Online -> remote app. Offline with downloads -> bundled app (Library).
            webView.loadUrl(this.bridge.getAppUrl());
        }
        registerNetworkCallback();
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private void buildOfflineOverlay() {
        offlineOverlay = new FrameLayout(this);
        offlineOverlay.setBackgroundColor(Color.BLACK);
        offlineOverlay.setClickable(true);
        offlineOverlay.setFocusable(true);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        column.setPadding(dp(32), dp(32), dp(32), dp(32));

        ImageView icon = new ImageView(this);
        icon.setImageResource(getApplicationInfo().icon);
        column.addView(icon, new LinearLayout.LayoutParams(dp(84), dp(84)));

        offlineTitle = new TextView(this);
        offlineTitle.setTextColor(Color.WHITE);
        offlineTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        offlineTitle.setTypeface(Typeface.DEFAULT_BOLD);
        offlineTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleLp.topMargin = dp(24);
        column.addView(offlineTitle, titleLp);

        TextView body = new TextView(this);
        body.setText("Periksa Wi-Fi atau data seluler kamu, lalu coba lagi.\\nLagu yang sudah di-download tetap bisa diputar lewat Mode Offline.");
        body.setTextColor(0xB3FFFFFF);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        body.setGravity(Gravity.CENTER);
        body.setLineSpacing(0f, 1.25f);
        LinearLayout.LayoutParams bodyLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bodyLp.topMargin = dp(10);
        column.addView(body, bodyLp);

        Button retry = new Button(this);
        retry.setText("Coba Lagi");
        retry.setAllCaps(false);
        retry.setTextColor(0xFF00174A);
        retry.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable retryBg = new GradientDrawable();
        retryBg.setColor(0xFF8AB4FF);
        retryBg.setCornerRadius(dp(24));
        retry.setBackground(retryBg);
        retry.setOnClickListener(v -> retryOnline(true));
        LinearLayout.LayoutParams retryLp = new LinearLayout.LayoutParams(dp(240), dp(48));
        retryLp.topMargin = dp(28);
        column.addView(retry, retryLp);

        Button offline = new Button(this);
        offline.setText("Buka Mode Offline");
        offline.setAllCaps(false);
        offline.setTextColor(Color.WHITE);
        GradientDrawable offlineBg = new GradientDrawable();
        offlineBg.setColor(Color.TRANSPARENT);
        offlineBg.setStroke(dp(1), 0x55FFFFFF);
        offlineBg.setCornerRadius(dp(24));
        offline.setBackground(offlineBg);
        offline.setOnClickListener(v -> openOfflineMode());
        LinearLayout.LayoutParams offlineLp = new LinearLayout.LayoutParams(dp(240), dp(48));
        offlineLp.topMargin = dp(12);
        column.addView(offline, offlineLp);

        offlineStatus = new TextView(this);
        offlineStatus.setTextColor(0x99FFFFFF);
        offlineStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        offlineStatus.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusLp.topMargin = dp(16);
        column.addView(offlineStatus, statusLp);

        offlineOverlay.addView(column, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        ViewGroup root = findViewById(android.R.id.content);
        root.addView(offlineOverlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offlineOverlay.setElevation(dp(16));
    }

    private void showOfflineScreen() {
        if (isFinishing() || isDestroyed()) return;
        dismissSplashImmediately();
        if (offlineOverlay == null) buildOfflineOverlay();
        boolean online = NetworkState.isOnline(this);
        offlineTitle.setText(online ? "Server Easvarafy tidak dapat dijangkau" : "Tidak ada koneksi internet");
        offlineStatus.setText("");
        offlineOverlay.setVisibility(View.VISIBLE);
        offlineOverlay.bringToFront();
        offlineOverlayVisible = true;
    }

    private void hideOfflineScreen() {
        offlineOverlayVisible = false;
        if (offlineOverlay != null) offlineOverlay.setVisibility(View.GONE);
    }

    private void retryOnline(boolean manual) {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        if (!NetworkState.isOnline(this)) {
            if (manual && offlineStatus != null) {
                offlineStatus.setText("Masih belum ada koneksi. Coba lagi sebentar lagi.");
            }
            return;
        }
        if (offlineStatus != null) offlineStatus.setText("Menyambungkan…");
        hideOfflineScreen();
        this.bridge.getWebView().loadUrl(this.bridge.getAppUrl());
    }

    private void openOfflineMode() {
        if (this.bridge == null || this.bridge.getWebView() == null || offlineClient == null) return;
        offlineClient.forceOfflineNextLoad();
        hideOfflineScreen();
        this.bridge.getWebView().loadUrl(this.bridge.getAppUrl());
    }

    private void registerNetworkCallback() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                    if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return;
                    offlineHandler.post(() -> {
                        // Back online while the retry screen is up -> reload automatically.
                        if (offlineOverlayVisible) {
                            offlineHandler.removeCallbacksAndMessages(null);
                            offlineHandler.postDelayed(() -> retryOnline(false), 600L);
                        }
                    });
                }
            };
            cm.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception ignored) {
            networkCallback = null;
        }
    }

    /**
     * Android 13+ hides every notification (including the media player in the
     * shade / lock screen) until POST_NOTIFICATIONS is granted at runtime.
     */
    // ------------------------------------------------------------------
    // Notifications: "Easvarafy has been updated" + admin broadcasts
    // ------------------------------------------------------------------

    private static final String UPDATES_CHANNEL_ID = "easvarafy_updates_channel";
    private static final String APP_PREFS = "easvarafy_app";
    private static final String KEY_LAST_VERSION_CODE = "last_launched_version_code";
    private static final String KEY_LAST_VERSION_NAME = "last_launched_version_name";
    private static final int UPDATED_NOTIFICATION_ID = 4220;
    private String pendingUpdatedVersion = null;

    private void setupNotifications() {
        try {
            BroadcastNotifier.ensureChannel(this);
            ensureUpdatesChannel();
            notifyIfAppUpdated();
            EasvarafyNotifyPlugin.dispatchOpenIntent(getIntent());
            if (BroadcastNotifier.isConfigured(this)) {
                NotificationPollJobService.schedule(this);
                // Catch up right away when the last poll is older than 15 minutes.
                if (System.currentTimeMillis() - BroadcastNotifier.lastPollAt(this) > 15L * 60L * 1000L) {
                    NotificationPollJobService.runSoon(this);
                }
            }
        } catch (Exception ignored) {
            // Notifications must never break app start.
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        EasvarafyNotifyPlugin.dispatchOpenIntent(intent);
    }

    private void ensureUpdatesChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(UPDATES_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            UPDATES_CHANNEL_ID, "Pembaruan aplikasi", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Pemberitahuan saat Easvarafy selesai diperbarui");
        nm.createNotificationChannel(channel);
    }

    /** Compares the running versionCode/versionName with the last launch. */
    private void notifyIfAppUpdated() {
        PackageInfo info;
        try {
            info = getPackageManager().getPackageInfo(getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException e) {
            return;
        }
        long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        String currentName = info.versionName != null ? info.versionName : String.valueOf(currentCode);
        SharedPreferences prefs = getSharedPreferences(APP_PREFS, MODE_PRIVATE);
        long lastCode = prefs.getLong(KEY_LAST_VERSION_CODE, -1L);
        String lastName = prefs.getString(KEY_LAST_VERSION_NAME, null);
        prefs.edit()
            .putLong(KEY_LAST_VERSION_CODE, currentCode)
            .putString(KEY_LAST_VERSION_NAME, currentName)
            .apply();

        boolean updated;
        if (lastCode < 0) {
            // First launch of a build with this feature: only an update (not a
            // fresh install) when the package was replaced after installing.
            updated = info.lastUpdateTime > info.firstInstallTime + 1000L;
        } else {
            updated = currentCode > lastCode
                || (currentCode == lastCode && lastName != null && compareVersionNames(currentName, lastName) > 0);
        }
        if (!updated) return;
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            // Shown as soon as the user grants the permission prompt.
            pendingUpdatedVersion = currentName;
            return;
        }
        postUpdatedNotification(currentName);
    }

    private void postUpdatedNotification(String versionName) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureUpdatesChannel();
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(this, UPDATED_NOTIFICATION_ID, open, flags);
        String label = versionName.startsWith("v") ? versionName : "v" + versionName;
        String text = "Easvarafy has been updated to " + label;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, UPDATES_CHANNEL_ID)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Easvarafy")
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setColor(0xFF7C5CFF)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(contentIntent);
        try {
            nm.notify(UPDATED_NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Permission revoked.
        }
    }

    private static int compareVersionNames(String a, String b) {
        String[] pa = a.replaceAll("^[vV]", "").split("[^0-9]+");
        String[] pb = b.replaceAll("^[vV]", "").split("[^0-9]+");
        int len = Math.max(pa.length, pb.length);
        for (int i = 0; i < len; i++) {
            int x = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int y = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return s == null || s.isEmpty() ? 0 : Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS && pendingUpdatedVersion != null
            && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            postUpdatedNotification(pendingUpdatedVersion);
            pendingUpdatedVersion = null;
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        String permission = "android.permission.POST_NOTIFICATIONS";
        if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { permission }, REQUEST_POST_NOTIFICATIONS);
        }
    }

    private void showNativeGifSplash() {
        splashOverlay = findViewById(R.id.splash_overlay);
        if (splashOverlay == null) return;

        int gifResId = getResources().getIdentifier("loading", "raw", getPackageName());
        if (gifResId == 0) {
            splashOverlay.setVisibility(View.GONE);
            return;
        }

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int targetSize = Math.round(Math.min(dm.widthPixels, dm.heightPixels) * 0.72f);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(targetSize, targetSize, Gravity.CENTER);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                ImageDecoder.Source source = ImageDecoder.createSource(getResources(), gifResId);
                Drawable drawable = ImageDecoder.decodeDrawable(source);
                ImageView imageView = new ImageView(this);
                imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
                imageView.setImageDrawable(drawable);
                splashOverlay.addView(imageView, lp);

                if (drawable instanceof AnimatedImageDrawable) {
                    splashAnimatedDrawable = (AnimatedImageDrawable) drawable;
                    splashAnimatedDrawable.setRepeatCount(AnimatedImageDrawable.REPEAT_INFINITE);
                    splashAnimatedDrawable.start();
                }
            } catch (Exception e) {
                dismissSplashImmediately();
                return;
            }
        } else {
            GifMovieView gifView = new GifMovieView(this, gifResId);
            splashOverlay.addView(gifView, lp);
        }

        splashStartTimeMs = SystemClock.uptimeMillis();
        scheduleSplashCheck();
    }

    private void scheduleSplashCheck() {
        splashHandler.postDelayed(() -> {
            if (splashDismissed || splashOverlay == null) return;
            long elapsed = SystemClock.uptimeMillis() - splashStartTimeMs;
            int progress = 100;
            if (this.bridge != null && this.bridge.getWebView() != null) {
                progress = this.bridge.getWebView().getProgress();
            }

            if ((elapsed >= MIN_SPLASH_MS && progress >= 100) || elapsed >= MAX_SPLASH_MS) {
                fadeOutSplash();
            } else {
                scheduleSplashCheck();
            }
        }, 120L);
    }

    private void fadeOutSplash() {
        if (splashDismissed || splashOverlay == null) return;
        splashDismissed = true;
        splashOverlay
            .animate()
            .alpha(0f)
            .setDuration(350L)
            .withEndAction(this::dismissSplashImmediately)
            .start();
    }

    private void dismissSplashImmediately() {
        splashDismissed = true;
        splashHandler.removeCallbacksAndMessages(null);
        if (splashAnimatedDrawable != null) {
            splashAnimatedDrawable.stop();
            splashAnimatedDrawable = null;
        }
        if (splashOverlay != null) {
            splashOverlay.setVisibility(View.GONE);
            if (splashOverlay.getParent() instanceof ViewGroup) {
                ((ViewGroup) splashOverlay.getParent()).removeView(splashOverlay);
            }
            splashOverlay = null;
        }
    }

    @Override
    public void onDestroy() {
        offlineHandler.removeCallbacksAndMessages(null);
        if (networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
                // already unregistered
            }
            networkCallback = null;
        }
        dismissSplashImmediately();
        if (isFinishing()) {
            stopService(new Intent(this, MediaPlaybackService.class));
        }
        super.onDestroy();
    }
}
`,
  'utf8'
);

writeFileSync(
  path.join(layoutDir, 'capacitor_bridge_layout_main.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    tools:context="com.easvarafy.app.MainActivity">

    <com.easvarafy.app.BackgroundWebView
        android:id="@+id/webview"
        android:layout_width="fill_parent"
        android:layout_height="fill_parent" />

    <FrameLayout
        android:id="@+id/splash_overlay"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="#000000"
        android:clickable="true"
        android:focusable="true" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`,
  'utf8'
);

console.log('✓ Configured native GIF splash screen, BackgroundWebView, offline screen, and MainActivity');

// ---------------------------------------------------------------------------
// versionCode / versionName (CI: APP_VERSION_CODE=github.run_number,
// APP_VERSION_NAME=package.json version). Used by the in-app update check and
// the "Easvarafy has been updated" notification.
// ---------------------------------------------------------------------------
const appGradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (existsSync(appGradlePath)) {
  let gradle = readFileSync(appGradlePath, 'utf8');
  const pkgVersion = (() => {
    try {
      return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  })();
  const rawCode = Number.parseInt(process.env.APP_VERSION_CODE || '', 10);
  const versionCode = Number.isFinite(rawCode) && rawCode > 0 && rawCode < 2100000000 ? rawCode : 1;
  const rawName = (process.env.APP_VERSION_NAME || pkgVersion).trim().replace(/^v/i, '');
  const versionName = /^[0-9A-Za-z._+-]{1,40}$/.test(rawName) ? rawName : pkgVersion;
  const before = gradle;
  const signingScript = "apply from: '../../scripts/android-release-signing.gradle'";
  if (!gradle.includes(signingScript)) gradle += `\n${signingScript}\n`;
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
  if (gradle !== before) {
    writeFileSync(appGradlePath, gradle, 'utf8');
  }
  console.log(`✓ Android versionCode ${versionCode}, versionName "${versionName}"`);
} else {
  console.warn('! android/app/build.gradle not found; versionCode/versionName not set');
}

// Firebase (FCM push). The Capacitor template applies the google-services
// Gradle plugin automatically when android/app/google-services.json exists.
const googleServicesSrc = path.join(nativeAndroidDir, 'google-services.json');
if (existsSync(googleServicesSrc) && existsSync(path.join(root, 'android', 'app'))) {
  copyFileSync(googleServicesSrc, path.join(root, 'android', 'app', 'google-services.json'));
  console.log('✓ Copied google-services.json (FCM push enabled)');
} else {
  console.log('· No native/android/google-services.json; FCM push disabled (poller + realtime still work)');
}

if (existsSync(gradlePropsPath)) {
  let props = readFileSync(gradlePropsPath, 'utf8');
  if (props.includes('org.gradle.jvmargs=-Xmx1536m')) {
    props = props.replace('org.gradle.jvmargs=-Xmx1536m', 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8');
    writeFileSync(gradlePropsPath, props, 'utf8');
    console.log('✓ Updated org.gradle.jvmargs in android/gradle.properties');
  }
}
