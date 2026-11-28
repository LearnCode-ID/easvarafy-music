package com.easvarafy.app;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.media.MediaExtractor;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.*;

/** Foreground-only, cancellable streaming transfer. No storage permission, base64 or audio in JS. */
@CapacitorPlugin(name = "EasvarafyDownload")
public class EasvarafyDownloadPlugin extends Plugin {
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final ConcurrentHashMap<String, Transfer> transfers = new ConcurrentHashMap<>();
    private static final long MAX = 250L * 1024 * 1024;
    private static class Transfer {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
    }
    private File audioDir() throws IOException {
        File dir = new File(getContext().getFilesDir(), "offline/audio");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("STORAGE");
        return dir;
    }
    private boolean wifi() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities nc = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
        return nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }
    private AtomicFile indexFile() throws IOException {
        audioDir(); // also ensures offline/ exists
        return new AtomicFile(new File(getContext().getFilesDir(), "offline/index.json"));
    }
    @PluginMethod public void readIndex(PluginCall call) {
        io.execute(() -> {
            try {
                AtomicFile index = indexFile();
                JSObject out = new JSObject();
                try (InputStream in = index.openRead(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        if (bytes.size() + count > 20 * 1024 * 1024) throw new IOException("INDEX_TOO_LARGE");
                        bytes.write(buffer,0,count);
                    }
                    out.put("json", bytes.toString("UTF-8"));
                } catch (FileNotFoundException missing) {
                    if (index.getBaseFile().exists()) throw missing;
                    out.put("json", "{\"version\":2,\"tracks\":[]}");
                }
                call.resolve(out);
            } catch (Exception e) { call.reject("Daftar unduhan lokal tidak dapat dibaca.", "STORAGE"); }
        });
    }
    @PluginMethod public void writeIndex(PluginCall call) {
        io.execute(() -> {
            AtomicFile index = null; FileOutputStream out = null;
            try {
                String json = call.getString("json", "");
                new org.json.JSONObject(json); // malformed metadata never replaces the last valid index
                byte[] data = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                if (data.length > 20 * 1024 * 1024) throw new IOException("INDEX_TOO_LARGE");
                index = indexFile(); out = index.startWrite();
                out.write(data);
                index.finishWrite(out); out = null; call.resolve();
            } catch (Exception e) {
                if (index != null && out != null) index.failWrite(out);
                call.reject("Metadata unduhan tidak dapat disimpan. Periksa ruang penyimpanan.", "STORAGE");
            }
        });
    }
    @PluginMethod public void network(PluginCall call) {
        JSObject out = new JSObject(); out.put("wifi", wifi()); call.resolve(out);
    }
    @PluginMethod public void cancel(PluginCall call) {
        Transfer t = transfers.get(call.getString("id", ""));
        if (t != null) { t.cancelled = true; if (t.connection != null) t.connection.disconnect(); }
        call.resolve();
    }
    private void check(Transfer t, boolean wifiOnly) throws IOException {
        if (t.cancelled) throw new IOException("CANCELLED");
        if (wifiOnly && !wifi()) throw new IOException("WIFI_REQUIRED");
    }
    private String extension(byte[] b, int n) throws IOException {
        if (n < 12) throw new IOException("INVALID_AUDIO");
        String s = new String(b, 0, Math.min(n, 12), java.nio.charset.StandardCharsets.ISO_8859_1);
        if (s.startsWith("ID3") || ((b[0]&255)==255 && (b[1]&224)==224 && (b[1]&6)!=0)) return "mp3";
        if (s.startsWith("RIFF") && s.substring(8).equals("WAVE")) return "wav";
        if (s.startsWith("OggS")) return "ogg";
        if (s.startsWith("fLaC")) return "flac";
        if (s.substring(4,8).equals("ftyp")) return "m4a";
        if ((b[0]&255)==26 && (b[1]&255)==69 && (b[2]&255)==223 && (b[3]&255)==163) return "webm";
        throw new IOException("INVALID_AUDIO");
    }
    private String mime(String ext) {
        switch (ext) {
            case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "flac": return "audio/flac";
            default: return "audio/webm";
        }
    }
    private void playable(File file) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getAbsolutePath());
            if (android.os.Build.VERSION.SDK_INT >= 24 && extractor.getDrmInitData() != null) throw new IOException("DRM_UNSUPPORTED");
            boolean decoder = false;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat format = extractor.getTrackFormat(i);
                String type = format.getString(MediaFormat.KEY_MIME);
                if (type != null && type.startsWith("audio/") && new MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) != null) decoder = true;
            }
            if (!decoder) throw new IOException("INVALID_AUDIO");
        } finally { extractor.release(); }
        MediaMetadataRetriever media = new MediaMetadataRetriever();
        try {
            media.setDataSource(file.getAbsolutePath());
            String duration = media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            String hasAudio = media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO);
            if (!"yes".equals(hasAudio) || duration == null || Long.parseLong(duration) <= 0) throw new IOException("INVALID_AUDIO");
        } finally { media.release(); }
    }
    private String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] b = new byte[65536]; int n;
            while ((n = in.read(b)) != -1) digest.update(b, 0, n);
        }
        StringBuilder out = new StringBuilder();
        for (byte b : digest.digest()) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    private File localFile(String uri) throws Exception {
        File f = new File(Uri.parse(uri).getPath()).getCanonicalFile();
        if (!f.getParentFile().equals(audioDir().getCanonicalFile()) || f.getName().endsWith(".part")) throw new IOException("INVALID_PATH");
        return f;
    }
    @PluginMethod public void inspect(PluginCall call) {
        io.execute(() -> {
            try {
                File file = localFile(call.getString("uri", ""));
                long size = call.getDouble("size", 0.0).longValue();
                if (!file.isFile() || file.length() < 128 || (size > 0 && size != file.length())) throw new IOException("INVALID_AUDIO");
                String digest = hash(file);
                String expected = call.getString("sha256", "");
                if (!expected.isEmpty() && !expected.equals(digest)) throw new IOException("INVALID_AUDIO");
                playable(file);
                JSObject out = new JSObject(); out.put("valid", true); out.put("sha256", digest); call.resolve(out);
            } catch (Exception e) { JSObject out = new JSObject(); out.put("valid", false); call.resolve(out); }
        });
    }
    @PluginMethod public void cleanupParts(PluginCall call) {
        // A WebView reload may leave a transfer from the previous JS runtime.
        // It has no durable queue/owner; cancel it before startup reconciliation.
        for (Transfer t : transfers.values()) { t.cancelled = true; if (t.connection != null) t.connection.disconnect(); }
        io.execute(() -> {
            try {
                File[] files = audioDir().listFiles();
                if (files != null) for (File f : files) if (f.getName().endsWith(".part")) {
                    if (!f.delete()) throw new IOException("STORAGE");
                }
                call.resolve();
            } catch (Exception e) { call.reject("Tidak dapat membersihkan file parsial.", "STORAGE"); }
        });
    }
    @PluginMethod public void prune(PluginCall call) {
        io.execute(() -> {
            try {
                java.util.HashSet<String> keep = new java.util.HashSet<>();
                org.json.JSONArray uris = call.getArray("uris");
                if (uris == null) throw new IOException("INVALID_PATH");
                for (int i=0; i<uris.length(); i++) keep.add(new File(Uri.parse(uris.getString(i)).getPath()).getCanonicalPath());
                for (String subdir : new String[] { "audio", "art" }) {
                    File dir = new File(getContext().getFilesDir(), "offline/" + subdir);
                    File[] files = dir.listFiles();
                    if (files != null) for (File file : files) {
                        if (file.isFile() && !keep.contains(file.getCanonicalPath()) && !file.delete()) throw new IOException("STORAGE");
                    }
                }
                call.resolve();
            } catch (Exception e) { call.reject("File unduhan sisa tidak dapat dibersihkan.", "STORAGE"); }
        });
    }
    @PluginMethod public void transfer(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[a-z0-9_-]+:[A-Za-z0-9_-]{6,64}")) { call.reject("ID tidak valid.", "INVALID_ID"); return; }
        Transfer t = new Transfer();
        if (transfers.putIfAbsent(id, t) != null) { call.reject("Unduhan sedang berjalan.", "DUPLICATE"); return; }
        io.execute(() -> {
            File part = null, target = null;
            try {
                URL url = new URL(call.getString("url", ""));
                String configured = getContext().getString(getContext().getResources().getIdentifier("easvarafy_download_origin", "string", getContext().getPackageName()));
                URL origin = new URL(configured);
                // Only the built-in, source-validated API; never arbitrary URLs or redirects.
                if (!"https".equals(url.getProtocol()) || !url.getAuthority().equals(origin.getAuthority()) || !"/api/music/audio".equals(url.getPath()) || url.getUserInfo() != null) throw new IOException("INVALID_SOURCE");
                boolean wifiOnly = call.getBoolean("wifiOnly", false);
                check(t, wifiOnly);
                HttpURLConnection c = (HttpURLConnection) url.openConnection(); t.connection = c;
                c.setInstanceFollowRedirects(false); c.setConnectTimeout(20000); c.setReadTimeout(30000);
                c.setRequestProperty("Accept-Encoding", "identity");
                int status = c.getResponseCode();
                if (status != 200) throw new IOException("HTTP_" + status);
                String type = c.getContentType();
                if (type != null && (type.contains("text/") || type.contains("json") || type.contains("mpegurl") || type.contains("dash+xml"))) throw new IOException("INVALID_AUDIO");
                long total = c.getContentLengthLong();
                if (total <= 0) try { total = Long.parseLong(c.getHeaderField("X-Audio-Length")); } catch (Exception ignored) { total = -1; }
                if (total > MAX) throw new IOException("TOO_LARGE");
                File dir = audioDir();
                if (dir.getUsableSpace() < Math.max(total, 1024 * 1024) + 1024 * 1024) throw new IOException("NO_SPACE");
                part = new File(dir, id.replace(':', '_') + ".part");
                long received = 0, last = 0; byte[] head = new byte[64]; int headSize = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = in.read(buffer)) != -1) {
                        check(t, wifiOnly);
                        if (headSize < head.length) { int count = Math.min(n, head.length-headSize); System.arraycopy(buffer, 0, head, headSize, count); headSize += count; }
                        received += n;
                        if (received > MAX) throw new IOException("TOO_LARGE");
                        if (dir.getUsableSpace() < n + 65536) throw new IOException("NO_SPACE");
                        out.write(buffer, 0, n);
                        long now = System.currentTimeMillis();
                        if (now-last > 150) {
                            last = now;
                            JSObject event = new JSObject(); event.put("id", id); event.put("received", received); event.put("total", total > 0 ? total : null);
                            notifyListeners("progress", event);
                        }
                    }
                    out.getFD().sync();
                }
                check(t, wifiOnly);
                if (received < 128 || part.length() != received || (total > 0 && total != received)) throw new IOException("INCOMPLETE");
                String ext = extension(head, headSize);
                playable(part);
                String digest = hash(part);
                check(t, wifiOnly);
                target = new File(dir, id.replace(':', '_') + "_" + System.nanoTime() + "." + ext);
                if (!part.renameTo(target)) throw new IOException("STORAGE");
                check(t, wifiOnly);
                JSObject out = new JSObject(); out.put("localUri", Uri.fromFile(target).toString()); out.put("size", received);
                out.put("mimeType", mime(ext)); out.put("sha256", digest); call.resolve(out);
                target = null; // ownership passes to caller; on failure caller deletes it
            } catch (Exception e) {
                String code = t.cancelled ? "CANCELLED" : e instanceof SocketTimeoutException ? "TIMEOUT" : e instanceof SecurityException ? "PERMISSION_DENIED" : e instanceof IOException && e.getMessage() != null && e.getMessage().matches("[A-Z_0-9]+") ? e.getMessage() : "TRANSFER_FAILED";
                if (!t.cancelled) for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                    if (cause instanceof android.system.ErrnoException) {
                        int errno = ((android.system.ErrnoException) cause).errno;
                        if (errno == android.system.OsConstants.ENOSPC) code = "NO_SPACE";
                        if (errno == android.system.OsConstants.EACCES || errno == android.system.OsConstants.EPERM) code = "PERMISSION_DENIED";
                    }
                }
                call.reject("Transfer audio tidak selesai.", code); // never expose URLs/tokens/OS error paths
            } finally {
                if (t.connection != null) t.connection.disconnect();
                if (part != null && part.exists()) part.delete();
                if (target != null) target.delete();
                transfers.remove(id);
            }
        });
    }
    @Override protected void handleOnDestroy() {
        for (Transfer t : transfers.values()) { t.cancelled = true; if (t.connection != null) t.connection.disconnect(); }
        io.shutdown();
        super.handleOnDestroy();
    }
}
