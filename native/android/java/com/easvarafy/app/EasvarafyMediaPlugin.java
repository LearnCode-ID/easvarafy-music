package com.easvarafy.app;

import android.os.SystemClock;
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
 * native -> JS:  "mediaAction" event { action: play|pause|next|previous|seekto, position }
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
