package com.easvarafy.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * WebViewClient for the remote-hosted app (capacitor server.url):
 *
 *  1. Offline mode — when the phone has no connection at a page load, every
 *     request for the app's own host is answered from the copy of the web app
 *     bundled inside the APK (assets/public = Next.js static export). Library and
 *     downloaded songs keep working in airplane mode; Capacitor plugins still
 *     work because the page keeps the same origin.
 *  2. /_capacitor_file_/ — downloaded songs are served with proper HTTP Range
 *     support (206 + Accept-Ranges) so seeking inside offline audio works.
 *  3. Main-frame load errors are reported to MainActivity, which shows a native
 *     "no internet / retry" screen instead of Chrome's net::ERR_* page.
 */
public class OfflineWebViewClient extends BridgeWebViewClient {

    public interface Listener {
        void onMainFrameError(String description);
    }

    private static final String ASSET_ROOT = "public";
    private static final String FILE_PREFIX = "/_capacitor_file_";

    private final Bridge bridge;
    private final Context context;
    private final Listener listener;
    private final String appHost;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** Decided at every main-frame navigation; sticky for that page's sub-resources. */
    private volatile boolean offlineMode = false;
    /** One-shot: next main-frame navigation uses the bundled app even if "online". */
    private volatile boolean forceOfflineOnce = false;

    public OfflineWebViewClient(Bridge bridge, Listener listener) {
        super(bridge);
        this.bridge = bridge;
        this.context = bridge.getContext().getApplicationContext();
        this.listener = listener;
        String host = null;
        try {
            String serverUrl = bridge.getServerUrl();
            host = Uri.parse(serverUrl != null ? serverUrl : bridge.getAppUrl()).getHost();
        } catch (Exception ignored) {
            // fall back to no interception
        }
        this.appHost = host;
    }

    public boolean isOfflineMode() {
        return offlineMode;
    }

    /** Loads the bundled (offline) app on the next navigation. */
    public void forceOfflineNextLoad() {
        forceOfflineOnce = true;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String host = url.getHost();
        if (appHost != null && host != null && appHost.equalsIgnoreCase(host)) {
            String path = url.getPath() == null ? "/" : url.getPath();

            if (path.startsWith(FILE_PREFIX + "/")) {
                WebResourceResponse local = serveLocalFile(path.substring(FILE_PREFIX.length()), request);
                if (local != null) return local;
            }

            if (request.isForMainFrame()) {
                offlineMode = forceOfflineOnce || !NetworkState.isOnline(context);
                forceOfflineOnce = false;
            }

            if (offlineMode && "GET".equalsIgnoreCase(request.getMethod())) {
                WebResourceResponse bundled = serveBundled(path, request.isForMainFrame());
                if (bundled != null) return bundled;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request.isForMainFrame() && listener != null) {
            final String description = error != null && error.getDescription() != null
                ? error.getDescription().toString()
                : "";
            mainHandler.post(() -> listener.onMainFrameError(description));
        }
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        super.onReceivedHttpError(view, request, errorResponse);
        if (request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() >= 500 && listener != null) {
            final String description = "HTTP " + errorResponse.getStatusCode();
            mainHandler.post(() -> listener.onMainFrameError(description));
        }
    }

    // ------------------------------------------------------------------
    // Bundled offline app (assets/public)
    // ------------------------------------------------------------------

    private WebResourceResponse serveBundled(String path, boolean mainFrame) {
        if (path.startsWith("/api/")) return null; // let it fail -> JS shows its offline state
        String clean = path.contains("..") ? "/" : path;
        String lastSegment = clean.substring(clean.lastIndexOf('/') + 1);
        String[] candidates;
        if (clean.endsWith("/")) {
            candidates = new String[] { clean + "index.html" };
        } else if (!lastSegment.contains(".")) {
            candidates = new String[] { clean + "/index.html", clean + ".html" };
        } else {
            candidates = new String[] { clean };
        }
        AssetManager assets = context.getAssets();
        for (String candidate : candidates) {
            String assetPath = ASSET_ROOT + candidate;
            try {
                InputStream in = assets.open(assetPath);
                return buildAssetResponse(candidate, in);
            } catch (IOException ignored) {
                // try next
            }
        }
        if (mainFrame) {
            try {
                return buildAssetResponse("/offline.html", assets.open(ASSET_ROOT + "/offline.html"));
            } catch (IOException ignored) {
                return null;
            }
        }
        return null;
    }

    private WebResourceResponse buildAssetResponse(String path, InputStream in) {
        String mime = mimeFor(path);
        InputStream body = in;
        if ("text/html".equals(mime)) {
            // Older WebViews without DOCUMENT_START_SCRIPT need the Capacitor bridge injected.
            body = bridge.getLocalServer().getJavaScriptInjectedStream(in);
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("X-Easvarafy-Offline", "1");
        String encoding = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")
            ? "utf-8"
            : null;
        return new WebResourceResponse(mime, encoding, 200, "OK", headers, body);
    }

    // ------------------------------------------------------------------
    // Downloaded files with HTTP Range support
    // ------------------------------------------------------------------

    private WebResourceResponse serveLocalFile(String filePath, WebResourceRequest request) {
        try {
            File file = new File(Uri.decode(filePath));
            String canonical = file.getCanonicalPath();
            String filesDir = context.getFilesDir().getCanonicalPath();
            String cacheDir = context.getCacheDir().getCanonicalPath();
            if (!(canonical.startsWith(filesDir + File.separator) || canonical.startsWith(cacheDir + File.separator))) {
                return null; // not ours -> default Capacitor handling
            }
            if (!file.isFile()) {
                Map<String, String> h = new HashMap<>();
                h.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, null);
            }
            long length = file.length();
            String mime = mimeFor(canonical);
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");

            String range = null;
            Map<String, String> reqHeaders = request.getRequestHeaders();
            if (reqHeaders != null) {
                for (Map.Entry<String, String> e : reqHeaders.entrySet()) {
                    if ("range".equalsIgnoreCase(e.getKey())) {
                        range = e.getValue();
                        break;
                    }
                }
            }

            if (range != null && range.toLowerCase(Locale.ROOT).startsWith("bytes=") && length > 0) {
                String spec = range.substring(6).split(",")[0].trim();
                long start;
                long end;
                if (spec.startsWith("-")) {
                    long suffix = Long.parseLong(spec.substring(1));
                    start = Math.max(0, length - suffix);
                    end = length - 1;
                } else {
                    String[] parts = spec.split("-", 2);
                    start = Long.parseLong(parts[0]);
                    end = parts.length > 1 && !parts[1].isEmpty() ? Long.parseLong(parts[1]) : length - 1;
                }
                end = Math.min(end, length - 1);
                if (start > end || start >= length) {
                    headers.put("Content-Range", "bytes */" + length);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, null);
                }
                long count = end - start + 1;
                FileInputStream fis = new FileInputStream(file);
                long skipped = 0;
                while (skipped < start) {
                    long s = fis.skip(start - skipped);
                    if (s <= 0) break;
                    skipped += s;
                }
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
                headers.put("Content-Length", String.valueOf(count));
                return new WebResourceResponse(mime, null, 206, "Partial Content", headers, new BoundedInputStream(fis, count));
            }

            headers.put("Content-Length", String.valueOf(length));
            return new WebResourceResponse(mime, null, 200, "OK", headers, new FileInputStream(file));
        } catch (Exception e) {
            return null;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int q = p.indexOf('?');
        if (q >= 0) p = p.substring(0, q);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".txt")) return "text/x-component";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a") || p.endsWith(".aac") || p.endsWith(".mp4")) return "audio/mp4";
        if (p.endsWith(".webm")) return "audio/webm";
        if (p.endsWith(".ogg") || p.endsWith(".opus")) return "audio/ogg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".flac")) return "audio/flac";
        return "application/octet-stream";
    }

    /** Reads at most {@code remaining} bytes from the wrapped stream. */
    private static final class BoundedInputStream extends FilterInputStream {
        private long remaining;

        BoundedInputStream(InputStream in, long limit) {
            super(in);
            this.remaining = limit;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = super.read();
            if (b >= 0) remaining--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, remaining));
            if (n > 0) remaining -= n;
            return n;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), remaining);
        }
    }
}
