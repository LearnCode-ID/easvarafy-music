package com.easvarafy.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge between the web player (components/MusicProvider.tsx) and
 * {@link MediaPlaybackService}.
 *
 * JS  -> native: update({ title, artist, album, artworkUrl, playing, position, duration, playbackRate })
 *                clear()
 *                getIslandStatus() / setIslandEnabled({ enabled })
 *                openOverlaySettings() / openAccessibilitySettings() / openAppSettings()
 * native -> JS:  "mediaAction" event { action: play|pause|next|previous|seekto|open, position }
 */
@CapacitorPlugin(name = "EasvarafyMedia")
public class EasvarafyMediaPlugin extends Plugin {
    private static volatile EasvarafyMediaPlugin active = null;

    @Override
    public void load() {
        active = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) {
            active = null;
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        MediaPlaybackService.Snapshot s = new MediaPlaybackService.Snapshot();
        s.title = call.getString("title", "");
        s.artist = call.getString("artist", "");
        s.album = call.getString("album", "");
        String artwork = call.getString("artworkUrl", null);
        s.artworkUrl = artwork == null || artwork.isEmpty() ? null : artwork;
        s.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));

        double position = safe(call.getDouble("position", 0.0), 0.0);
        double duration = safe(call.getDouble("duration", 0.0), 0.0);
        double rate = safe(call.getDouble("playbackRate", 1.0), 1.0);
        s.positionMs = Math.max(0L, Math.round(position * 1000.0));
        s.durationMs = Math.max(0L, Math.round(duration * 1000.0));
        s.speed = rate > 0 ? (float) rate : 1f;
        s.sampledAt = SystemClock.elapsedRealtime();

        MediaPlaybackService.applySnapshot(getContext(), s);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        MediaPlaybackService.clear(getContext());
        call.resolve();
    }

    // ------------------------------------------------------------------
    // System Dynamic Island
    // ------------------------------------------------------------------

    @PluginMethod
    public void getIslandStatus(PluginCall call) {
        // Permission may have just been granted in system settings – re-evaluate.
        refreshIslandOnMain();
        call.resolve(islandStatus());
    }

    @PluginMethod
    public void setIslandEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        DynamicIslandController.setEnabled(getContext(), enabled);
        refreshIslandOnMain();
        call.resolve(islandStatus());
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startSettings(call, intent);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        startSettings(call, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startSettings(call, intent);
    }

    private void startSettings(PluginCall call, Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Unable to open settings", e2);
            }
        }
    }

    private JSObject islandStatus() {
        boolean overlay = DynamicIslandController.canDrawOverlays(getContext());
        boolean accessibility = IslandAccessibilityService.isRunning();
        boolean enabled = DynamicIslandController.isEnabled(getContext());
        String mode = accessibility
            ? DynamicIslandController.MODE_ACCESSIBILITY
            : overlay ? DynamicIslandController.MODE_OVERLAY : DynamicIslandController.MODE_NONE;
        JSObject o = new JSObject();
        o.put("supported", true);
        o.put("enabled", enabled);
        o.put("overlayPermission", overlay);
        o.put("accessibilityEnabled", accessibility);
        o.put("mode", mode);
        o.put("active", enabled && !DynamicIslandController.MODE_NONE.equals(mode));
        return o;
    }

    private void refreshIslandOnMain() {
        final android.content.Context ctx = getContext();
        new Handler(Looper.getMainLooper()).post(() -> {
            DynamicIslandController.get(ctx).refresh();
            MediaPlaybackService.refreshIsland();
        });
    }

    /** Called by the service when the user presses a media control. */
    static void dispatchAction(String action, double positionSec) {
        EasvarafyMediaPlugin plugin = active;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        if (positionSec >= 0) {
            data.put("position", positionSec);
        }
        plugin.notifyListeners("mediaAction", data);
    }

    private static double safe(Double value, double fallback) {
        if (value == null || value.isNaN() || value.isInfinite()) return fallback;
        return value;
    }
}
