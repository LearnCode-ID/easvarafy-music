package com.easvarafy.app;

import android.accessibilityservice.AccessibilityService;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.ComponentCallbacks;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Display;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

/**
 * System-wide "Dynamic Island" for Android.
 *
 * Draws an iPhone-style black pill around the front camera, on top of every
 * app (not inside the WebView). Tap to expand into a mini player, tap outside
 * to collapse, long-press to open Easvarafy.
 *
 * Two hosting modes:
 *  - "accessibility": window type TYPE_ACCESSIBILITY_OVERLAY from
 *    {@link IslandAccessibilityService}. This is the only window type a normal
 *    app may place above the status bar, so the island can sit exactly around
 *    the camera cut-out and still receive touches (same approach as dynamicSpot).
 *  - "overlay": TYPE_APPLICATION_OVERLAY with the "display over other apps"
 *    permission. Android keeps these under the status bar, so the island is
 *    placed just below it instead.
 *
 * All methods must be called on the main thread.
 */
final class DynamicIslandController {
    private static final String TAG = "EasvarafyIsland";
    private static final String PREFS = "easvarafy_island";
    private static final String KEY_ENABLED = "enabled";
    private static final long AUTO_COLLAPSE_MS = 7000L;

    static final String MODE_ACCESSIBILITY = "accessibility";
    static final String MODE_OVERLAY = "overlay";
    static final String MODE_NONE = "none";

    @SuppressLint("StaticFieldLeak") // application context only
    private static DynamicIslandController sInstance;

    static DynamicIslandController get(Context context) {
        if (sInstance == null) {
            sInstance = new DynamicIslandController(context.getApplicationContext());
        }
        return sInstance;
    }

    // ------------------------------------------------------------------

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AccessibilityService accessibilityService;

    private String attachedMode = MODE_NONE;
    private WindowManager wm;
    private IslandView view;
    private WindowManager.LayoutParams lp;
    private ValueAnimator animator;

    private MediaPlaybackService.Snapshot snapshot;
    private Bitmap artwork;
    private int accent = Color.WHITE;
    private boolean expanded = false;
    private boolean screenLocked = false;
    private boolean systemHooksRegistered = false;

    private final Runnable autoCollapse = () -> setExpanded(false);
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (view == null || snapshot == null) return;
            view.updateProgress(snapshot);
            main.postDelayed(this, 500L);
        }
    };

    private DynamicIslandController(Context app) {
        this.app = app;
    }

    // ------------------------------------------------------------------
    // Settings / status
    // ------------------------------------------------------------------

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean canDrawOverlays(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
    }

    /** Which host would be used right now (ignores the on/off preference). */
    String availableMode() {
        if (accessibilityService != null) return MODE_ACCESSIBILITY;
        if (canDrawOverlays(app)) return MODE_OVERLAY;
        return MODE_NONE;
    }

    boolean isShowing() {
        return view != null;
    }

    // ------------------------------------------------------------------
    // Inputs
    // ------------------------------------------------------------------

    void onAccessibilityConnected(AccessibilityService service) {
        accessibilityService = service;
        refresh();
    }

    void onAccessibilityDisconnected(AccessibilityService service) {
        if (accessibilityService == service) {
            accessibilityService = null;
            // Window belonged to the service; it is gone with it.
            if (MODE_ACCESSIBILITY.equals(attachedMode)) detach();
        }
        refresh();
    }

    void update(MediaPlaybackService.Snapshot s, Bitmap art) {
        snapshot = s;
        if (art != artwork) {
            artwork = art;
            accent = accentFrom(art);
        }
        refresh();
    }

    void clear() {
        snapshot = null;
        refresh();
    }

    // ------------------------------------------------------------------
    // Show / hide
    // ------------------------------------------------------------------

    void refresh() {
        registerSystemHooks();
        String mode = isEnabled(app) ? availableMode() : MODE_NONE;
        boolean portrait =
            app.getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
        boolean shouldShow = snapshot != null && !MODE_NONE.equals(mode) && portrait && !screenLocked;

        if (!shouldShow || (view != null && !mode.equals(attachedMode))) {
            detach();
        }
        if (!shouldShow) return;

        if (view == null && !attach(mode)) return;
        view.bind(snapshot, artwork, accent, expanded);
        if (animator == null || !animator.isRunning()) {
            applyLayout(false);
        }
        main.removeCallbacks(ticker);
        if (expanded) main.post(ticker);
    }

    @SuppressWarnings("deprecation")
    private boolean attach(String mode) {
        Context host;
        int type;
        if (MODE_ACCESSIBILITY.equals(mode) && accessibilityService != null) {
            host = accessibilityService;
            type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
        } else {
            type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
            host = app;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                DisplayManager dm = app.getSystemService(DisplayManager.class);
                Display display = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
                if (display != null) {
                    host = app.createDisplayContext(display).createWindowContext(type, null);
                }
            }
        }

        wm = (WindowManager) host.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return false;

        view = new IslandView(host);
        lp = new WindowManager.LayoutParams(
            1,
            1,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS |
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH |
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        );
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.setTitle("Easvarafy Dynamic Island");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        Geometry g = geometry(mode);
        lp.width = g.compactW;
        lp.height = g.compactH;
        lp.x = g.centerX - g.compactW / 2;
        lp.y = g.compactY;

        try {
            wm.addView(view, lp);
            attachedMode = mode;
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Unable to add Dynamic Island window (" + mode + ")", e);
            view = null;
            wm = null;
            attachedMode = MODE_NONE;
            return false;
        }
    }

    private void detach() {
        main.removeCallbacks(ticker);
        main.removeCallbacks(autoCollapse);
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
        if (view != null && wm != null) {
            try {
                wm.removeViewImmediate(view);
            } catch (Exception ignored) {
                // already gone
            }
        }
        view = null;
        wm = null;
        attachedMode = MODE_NONE;
        expanded = false;
    }

    private void setExpanded(boolean value) {
        if (view == null) return;
        if (expanded == value) {
            if (value) scheduleAutoCollapse();
            return;
        }
        expanded = value;
        view.bind(snapshot, artwork, accent, expanded);
        applyLayout(true);
        main.removeCallbacks(ticker);
        if (expanded) {
            main.post(ticker);
            scheduleAutoCollapse();
        } else {
            main.removeCallbacks(autoCollapse);
        }
    }

    private void scheduleAutoCollapse() {
        main.removeCallbacks(autoCollapse);
        main.postDelayed(autoCollapse, AUTO_COLLAPSE_MS);
    }

    // ------------------------------------------------------------------
    // Geometry
    // ------------------------------------------------------------------

    private static final class Geometry {
        int centerX;
        int compactW;
        int compactH;
        int compactY;
        int expandedW;
        int expandedY;
        int expandedTopInset;
    }

    @SuppressWarnings("deprecation")
    private Geometry geometry(String mode) {
        Geometry g = new Geometry();
        WindowManager windowManager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
        Display display = windowManager != null ? windowManager.getDefaultDisplay() : null;
        DisplayMetrics real = new DisplayMetrics();
        if (display != null) {
            display.getRealMetrics(real);
        } else {
            real = app.getResources().getDisplayMetrics();
        }
        int screenW = real.widthPixels;
        int statusBar = statusBarHeight();

        Rect cutout = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && display != null) {
            DisplayCutout dc = display.getCutout();
            if (dc != null) {
                for (Rect r : dc.getBoundingRects()) {
                    // Front camera at the top edge (hole-punch / notch).
                    if (r.top <= dp(8) && r.height() > 0 && r.height() < dp(80)) {
                        cutout = r;
                        break;
                    }
                }
            }
        }

        g.expandedW = Math.min(screenW - dp(16), dp(420));

        if (MODE_ACCESSIBILITY.equals(mode)) {
            if (cutout != null) {
                g.centerX = cutout.centerX();
                g.compactH = clamp(cutout.height() + dp(8), dp(28), dp(40));
                g.compactW = Math.max(cutout.width() + dp(132), dp(168));
                g.compactY = Math.max(0, cutout.centerY() - g.compactH / 2);
            } else {
                g.centerX = screenW / 2;
                g.compactH = clamp(statusBar - dp(6), dp(26), dp(36));
                g.compactW = dp(168);
                g.compactY = Math.max(dp(2), (statusBar - g.compactH) / 2);
            }
            g.expandedY = g.compactY;
        } else {
            g.centerX = screenW / 2;
            g.compactH = dp(34);
            g.compactW = dp(176);
            g.compactY = statusBar + dp(6);
            g.expandedY = g.compactY;
        }
        // In accessibility mode the expanded card starts at the camera, so push its
        // content below the cut-out (the camera ends up "inside" the island, like iOS).
        g.expandedTopInset = dp(16);
        if (MODE_ACCESSIBILITY.equals(mode)) {
            int cameraBottom = cutout != null ? cutout.bottom : g.compactY + g.compactH;
            g.expandedTopInset = Math.max(dp(14), cameraBottom - g.expandedY + dp(8));
        }
        // Keep the island fully on screen.
        g.compactW = Math.min(g.compactW, screenW - dp(16));
        return g;
    }

    private void applyLayout(boolean animate) {
        if (view == null || wm == null || lp == null) return;
        Geometry g = geometry(attachedMode);
        final int targetW;
        final int targetH;
        final int targetX;
        final int targetY;
        if (expanded) {
            targetW = g.expandedW;
            view.setTopInset(g.expandedTopInset);
            view.measureExpanded(targetW);
            targetH = view.expandedHeight();
            targetX = clamp(g.centerX - targetW / 2, dp(8), Math.max(dp(8), screenWidth() - targetW - dp(8)));
            targetY = g.expandedY;
        } else {
            targetW = g.compactW;
            targetH = g.compactH;
            targetX = g.centerX - targetW / 2;
            targetY = g.compactY;
        }

        if (animator != null) animator.cancel();
        if (!animate) {
            setWindow(targetW, targetH, targetX, targetY);
            view.setMorph(expanded ? 1f : 0f);
            return;
        }

        final int fromW = lp.width;
        final int fromH = lp.height;
        final int fromX = lp.x;
        final int fromY = lp.y;
        final float fromMorph = view.getMorph();
        final float toMorph = expanded ? 1f : 0f;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(expanded ? 420L : 320L);
        // iOS-like spring feel: fast start, gentle overshoot-free settle.
        animator.setInterpolator(new PathInterpolator(0.2f, 0.9f, 0.1f, 1f));
        animator.addUpdateListener(a -> {
            float t = (float) a.getAnimatedValue();
            setWindow(
                lerp(fromW, targetW, t),
                lerp(fromH, targetH, t),
                lerp(fromX, targetX, t),
                lerp(fromY, targetY, t)
            );
            if (view != null) view.setMorph(fromMorph + (toMorph - fromMorph) * t);
        });
        animator.start();
    }

    private void setWindow(int w, int h, int x, int y) {
        if (view == null || wm == null) return;
        lp.width = Math.max(1, w);
        lp.height = Math.max(1, h);
        lp.x = x;
        lp.y = y;
        try {
            wm.updateViewLayout(view, lp);
        } catch (Exception ignored) {
            // window detached mid-animation
        }
    }

    // ------------------------------------------------------------------
    // Screen lock / rotation
    // ------------------------------------------------------------------

    private void registerSystemHooks() {
        if (systemHooksRegistered) return;
        systemHooksRegistered = true;

        KeyguardManager km = (KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE);
        screenLocked = km != null && km.isKeyguardLocked();

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    screenLocked = true;
                } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                    screenLocked = false;
                } else if (Intent.ACTION_SCREEN_ON.equals(action)) {
                    KeyguardManager k = (KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE);
                    screenLocked = k != null && k.isKeyguardLocked();
                }
                refresh();
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                app.registerReceiver(receiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "Screen receiver registration failed", e);
        }

        app.registerComponentCallbacks(new ComponentCallbacks() {
            @Override
            public void onConfigurationChanged(Configuration newConfig) {
                main.post(() -> {
                    detach();
                    refresh();
                });
            }

            @Override
            public void onLowMemory() {}
        });
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    private void openApp() {
        setExpanded(false);
        Intent intent = new Intent(app, MainActivity.class);
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );
        try {
            Context launcher = accessibilityService != null ? accessibilityService : app;
            launcher.startActivity(intent);
        } catch (Exception e) {
            Log.w(TAG, "Unable to open app from island", e);
        }
        EasvarafyMediaPlugin.dispatchAction("open", -1);
    }

    private void transport(String action) {
        MediaPlaybackService.requestTransport(action, -1);
        if (expanded) scheduleAutoCollapse();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, app.getResources().getDisplayMetrics()));
    }

    private int screenWidth() {
        return app.getResources().getDisplayMetrics().widthPixels;
    }

    private int statusBarHeight() {
        int id = app.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? app.getResources().getDimensionPixelSize(id) : dp(24);
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static int lerp(int a, int b, float t) {
        return Math.round(a + (b - a) * t);
    }

    private static int accentFrom(Bitmap art) {
        if (art == null) return Color.WHITE;
        try {
            Bitmap one = Bitmap.createScaledBitmap(art, 1, 1, true);
            int c = one.getPixel(0, 0);
            float[] hsv = new float[3];
            Color.colorToHSV(c, hsv);
            if (hsv[1] < 0.12f) return Color.WHITE; // greyscale cover
            hsv[1] = Math.max(hsv[1], 0.5f);
            hsv[2] = Math.max(hsv[2], 0.9f);
            return Color.HSVToColor(hsv);
        } catch (Exception e) {
            return Color.WHITE;
        }
    }

    private static String formatTime(long ms) {
        long total = Math.max(0L, ms / 1000L);
        long m = total / 60L;
        long s = total % 60L;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    // ==================================================================
    // Views
    // ==================================================================

    @SuppressLint("ViewConstructor")
    private final class IslandView extends FrameLayout {
        private final GradientDrawable bg = new GradientDrawable();
        private final LinearLayout compact;
        private final LinearLayout full;
        private final ImageView compactArt;
        private final EqualizerView compactEq;
        private final ImageView fullArt;
        private final TextView title;
        private final TextView artist;
        private final EqualizerView fullEq;
        private final SeekBar seek;
        private final TextView elapsed;
        private final TextView remaining;
        private final ImageButton playPause;
        private float morph = 0f;
        private boolean userSeeking = false;
        private long downAt = 0L;

        IslandView(Context context) {
            super(context);
            bg.setColor(Color.BLACK);
            bg.setCornerRadius(dp(18));
            setBackground(bg);
            setClipToOutline(true);
            setOutlineProvider(ViewOutlineProvider.BACKGROUND);
            setElevation(dp(6));

            // ---------- compact pill ----------
            compact = new LinearLayout(context);
            compact.setOrientation(LinearLayout.HORIZONTAL);
            compact.setGravity(Gravity.CENTER_VERTICAL);
            compact.setPadding(dp(5), dp(4), dp(12), dp(4));

            compactArt = new ImageView(context);
            compactArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
            roundOutline(compactArt, -1);
            compact.addView(compactArt, new LinearLayout.LayoutParams(0, 0));

            View spacer = new View(context);
            compact.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

            compactEq = new EqualizerView(context, 3);
            compact.addView(compactEq, new LinearLayout.LayoutParams(dp(16), dp(13)));

            addView(compact, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

            // ---------- expanded player ----------
            full = new LinearLayout(context);
            full.setOrientation(LinearLayout.VERTICAL);
            full.setPadding(dp(18), dp(16), dp(18), dp(12));

            LinearLayout header = new LinearLayout(context);
            header.setOrientation(LinearLayout.HORIZONTAL);
            header.setGravity(Gravity.CENTER_VERTICAL);

            fullArt = new ImageView(context);
            fullArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
            roundOutline(fullArt, dp(14));
            header.addView(fullArt, new LinearLayout.LayoutParams(dp(54), dp(54)));

            LinearLayout meta = new LinearLayout(context);
            meta.setOrientation(LinearLayout.VERTICAL);
            meta.setPadding(dp(12), 0, dp(10), 0);
            title = text(context, 15.5f, Color.WHITE, true);
            artist = text(context, 13f, 0x99FFFFFF, false);
            meta.addView(title);
            meta.addView(artist);
            header.addView(meta, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            fullEq = new EqualizerView(context, 4);
            header.addView(fullEq, new LinearLayout.LayoutParams(dp(24), dp(20)));
            full.addView(header);

            seek = new SeekBar(context);
            seek.setPadding(dp(2), dp(14), dp(2), dp(6));
            seek.setMax(1000);
            seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                    if (fromUser && snapshot != null) {
                        elapsed.setText(formatTime(snapshot.durationMs * progress / 1000L));
                    }
                }

                @Override
                public void onStartTrackingTouch(SeekBar sb) {
                    userSeeking = true;
                    main.removeCallbacks(autoCollapse);
                }

                @Override
                public void onStopTrackingTouch(SeekBar sb) {
                    userSeeking = false;
                    if (snapshot != null && snapshot.durationMs > 0) {
                        long pos = snapshot.durationMs * sb.getProgress() / 1000L;
                        MediaPlaybackService.requestTransport("seekto", pos);
                    }
                    scheduleAutoCollapse();
                }
            });
            full.addView(seek, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            LinearLayout times = new LinearLayout(context);
            times.setOrientation(LinearLayout.HORIZONTAL);
            times.setPadding(dp(4), 0, dp(4), 0);
            elapsed = text(context, 11f, 0x99FFFFFF, false);
            elapsed.setTypeface(Typeface.MONOSPACE);
            remaining = text(context, 11f, 0x99FFFFFF, false);
            remaining.setTypeface(Typeface.MONOSPACE);
            remaining.setGravity(Gravity.END);
            times.addView(elapsed, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            times.addView(remaining, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            full.addView(times);

            LinearLayout controls = new LinearLayout(context);
            controls.setOrientation(LinearLayout.HORIZONTAL);
            controls.setGravity(Gravity.CENTER);
            controls.setPadding(0, dp(4), 0, 0);
            ImageButton prev = iconButton(context, R.drawable.island_ic_prev, dp(30));
            prev.setOnClickListener(v -> transport("previous"));
            playPause = iconButton(context, R.drawable.island_ic_pause, dp(40));
            playPause.setOnClickListener(v -> {
                boolean playing = snapshot != null && snapshot.playing;
                transport(playing ? "pause" : "play");
            });
            ImageButton next = iconButton(context, R.drawable.island_ic_next, dp(30));
            next.setOnClickListener(v -> transport("next"));
            controls.addView(prev, new LinearLayout.LayoutParams(dp(64), dp(52)));
            controls.addView(playPause, new LinearLayout.LayoutParams(dp(76), dp(56)));
            controls.addView(next, new LinearLayout.LayoutParams(dp(64), dp(52)));
            full.addView(controls, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            addView(full, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

            // Header tap -> open app (full player)
            header.setOnClickListener(v -> openApp());
            setMorph(0f);
        }

        private TextView text(Context c, float sp, int color, boolean bold) {
            TextView t = new TextView(c);
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
            t.setTextColor(color);
            t.setSingleLine(true);
            t.setEllipsize(TextUtils.TruncateAt.END);
            if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
            return t;
        }

        private ImageButton iconButton(Context c, int icon, int size) {
            ImageButton b = new ImageButton(c);
            b.setImageResource(icon);
            b.setBackground(null);
            b.setScaleType(ImageView.ScaleType.FIT_CENTER);
            int pad = Math.max(0, (dp(52) - size) / 2);
            b.setPadding(pad, pad, pad, pad);
            b.setColorFilter(Color.WHITE);
            return b;
        }

        private void roundOutline(View v, final int radius) {
            v.setClipToOutline(true);
            v.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    if (radius < 0) {
                        outline.setOval(0, 0, view.getWidth(), view.getHeight());
                    } else {
                        outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
                    }
                }
            });
        }

        void bind(MediaPlaybackService.Snapshot s, Bitmap art, int accentColor, boolean isExpanded) {
            if (s == null) return;
            compactArt.setImageBitmap(art);
            fullArt.setImageBitmap(art);
            if (art == null) {
                compactArt.setBackgroundColor(0xFF2A2A2E);
                fullArt.setBackgroundColor(0xFF2A2A2E);
            } else {
                compactArt.setBackground(null);
                fullArt.setBackground(null);
            }
            title.setText(s.title);
            artist.setText(s.artist);
            compactEq.setState(s.playing, accentColor);
            fullEq.setState(s.playing, accentColor);
            seek.setProgressTintList(ColorStateList.valueOf(accentColor));
            seek.setThumbTintList(ColorStateList.valueOf(Color.WHITE));
            seek.setProgressBackgroundTintList(ColorStateList.valueOf(0x40FFFFFF));
            playPause.setImageResource(s.playing ? R.drawable.island_ic_pause : R.drawable.island_ic_play);
            updateProgress(s);
        }

        void setTopInset(int px) {
            if (full.getPaddingTop() != px) {
                full.setPadding(full.getPaddingLeft(), px, full.getPaddingRight(), full.getPaddingBottom());
            }
        }

        void updateProgress(MediaPlaybackService.Snapshot s) {
            if (s == null || userSeeking) return;
            long pos = s.currentPositionMs();
            long dur = s.durationMs;
            seek.setProgress(dur > 0 ? (int) Math.min(1000L, pos * 1000L / dur) : 0);
            elapsed.setText(formatTime(pos));
            remaining.setText("-" + formatTime(Math.max(0L, dur - pos)));
        }

        void measureExpanded(int width) {
            full.measure(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            );
        }

        int expandedHeight() {
            return full.getMeasuredHeight();
        }

        float getMorph() {
            return morph;
        }

        void setMorph(float m) {
            morph = Math.max(0f, Math.min(1f, m));
            // Compact fades out quickly, expanded fades in during the second half.
            compact.setAlpha(Math.max(0f, 1f - morph * 2.2f));
            compact.setVisibility(morph >= 0.99f ? INVISIBLE : VISIBLE);
            float fullAlpha = Math.max(0f, (morph - 0.35f) / 0.65f);
            full.setAlpha(fullAlpha);
            full.setVisibility(morph <= 0.01f ? INVISIBLE : VISIBLE);
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            // Pill when compact, rounded card when expanded.
            bg.setCornerRadius(Math.min(h / 2f, dp(34)));
            int artSize = Math.max(dp(16), Math.min(h - dp(8), dp(30)));
            final ViewGroup.LayoutParams p = compactArt.getLayoutParams();
            if (!expanded && (p.width != artSize || p.height != artSize)) {
                p.width = artSize;
                p.height = artSize;
                post(() -> {
                    compactArt.setLayoutParams(p);
                    compactArt.invalidateOutline();
                });
            }
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent ev) {
            if (ev.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                if (expanded) setExpanded(false);
                return true;
            }
            if (expanded && ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
                scheduleAutoCollapse();
            }
            if (!expanded) {
                // Compact pill: tap = expand, long-press = open app.
                switch (ev.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downAt = SystemClock.uptimeMillis();
                        animate().scaleX(0.96f).scaleY(0.96f).setDuration(90L).start();
                        return true;
                    case MotionEvent.ACTION_UP:
                        animate().scaleX(1f).scaleY(1f).setDuration(140L).start();
                        if (SystemClock.uptimeMillis() - downAt > 550L) {
                            openApp();
                        } else {
                            setExpanded(true);
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        animate().scaleX(1f).scaleY(1f).setDuration(140L).start();
                        return true;
                    default:
                        return true;
                }
            }
            return super.dispatchTouchEvent(ev);
        }
    }

    /** Tiny animated waveform, like the iPhone "now playing" bars. */
    private final class EqualizerView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private final int bars;
        private boolean playing = false;
        private final long start = SystemClock.uptimeMillis();

        EqualizerView(Context context, int bars) {
            super(context);
            this.bars = bars;
            paint.setColor(Color.WHITE);
        }

        void setState(boolean isPlaying, int color) {
            playing = isPlaying;
            paint.setColor(color);
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            if (w <= 0 || h <= 0) return;
            float gap = w * 0.16f;
            float barW = (w - gap * (bars - 1)) / bars;
            double t = (SystemClock.uptimeMillis() - start) / 1000.0;
            for (int i = 0; i < bars; i++) {
                float level;
                if (playing) {
                    double phase = t * (5.2 + i * 1.7) + i * 1.3;
                    level = (float) (0.35 + 0.65 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.37 + i)));
                } else {
                    level = 0.22f;
                }
                float bh = Math.max(barW, h * level);
                float left = i * (barW + gap);
                rect.set(left, (h - bh) / 2f, left + barW, (h + bh) / 2f);
                canvas.drawRoundRect(rect, barW / 2f, barW / 2f, paint);
            }
            if (playing && isShown()) {
                postInvalidateDelayed(40L);
            }
        }
    }
}
