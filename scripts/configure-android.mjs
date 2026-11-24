#!/usr/bin/env node
/**
 * Post-`cap add/sync android` configuration script.
 * Ensures the generated Capacitor Android project includes:
 *  1. Deep-link intent filter for `com.easvarafy.app://auth/callback` (Google OAuth PKCE).
 *  2. Permissions & Foreground Service (`mediaPlayback` + WakeLock + BackgroundWebView)
 *     so music continues playing smoothly when the user minimizes the app or locks the screen.
 *  3. Adequate Gradle JVM heap (`-Xmx2048m`) for CI builds.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePropsPath = path.join(root, 'android', 'gradle.properties');
const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'easvarafy', 'app');
const layoutDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'layout');

if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, 'utf8');

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

  // Add required permissions for background media playback
  const requiredPermissions = [
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.POST_NOTIFICATIONS',
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

// Write BackgroundWebView, MediaPlaybackService, MainActivity, and layout override
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
  path.join(javaDir, 'MediaPlaybackService.java'),
  `package com.easvarafy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class MediaPlaybackService extends Service {
    private static final String CHANNEL_ID = "easvarafy_playback_channel";
    private static final int NOTIFICATION_ID = 1001;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Easvarafy::MediaPlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Easvarafy")
            .setContentText("Pemutaran musik latar belakang aktif")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire();
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Pemutaran Musik",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Menjaga musik tetap berjalan saat aplikasi diminimize");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
`,
  'utf8'
);

writeFileSync(
  path.join(javaDir, 'MainActivity.java'),
  `package com.easvarafy.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        Intent serviceIntent = new Intent(this, MediaPlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    public void onDestroy() {
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

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`,
  'utf8'
);

console.log('✓ Configured BackgroundWebView, MediaPlaybackService, and MainActivity for background playback');

if (existsSync(gradlePropsPath)) {
  let props = readFileSync(gradlePropsPath, 'utf8');
  if (props.includes('org.gradle.jvmargs=-Xmx1536m')) {
    props = props.replace('org.gradle.jvmargs=-Xmx1536m', 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8');
    writeFileSync(gradlePropsPath, props, 'utf8');
    console.log('✓ Updated org.gradle.jvmargs in android/gradle.properties');
  }
}
