package com.easvarafy.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/** Connectivity + offline-library helpers used by MainActivity / OfflineWebViewClient. */
public final class NetworkState {

    private NetworkState() {}

    /** True when Android reports a network with internet capability. */
    public static boolean isOnline(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            Network network = cm.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            // ACCESS_NETWORK_STATE missing or OEM quirk: assume online, errors are still caught later.
            return true;
        }
    }

    /**
     * True when at least one song was downloaded (index written by
     * lib/metrolist/offlineAudio.ts into Directory.Data/offline/index.json).
     */
    public static boolean hasOfflineDownloads(Context context) {
        File index = new File(context.getFilesDir(), "offline/index.json");
        if (!index.isFile() || index.length() < 20) return false;
        try (FileInputStream in = new FileInputStream(index)) {
            byte[] buf = new byte[(int) Math.min(index.length(), 4096)];
            int n = in.read(buf);
            if (n <= 0) return false;
            return new String(buf, 0, n, StandardCharsets.UTF_8).contains("\"videoId\"");
        } catch (Exception e) {
            return false;
        }
    }
}
