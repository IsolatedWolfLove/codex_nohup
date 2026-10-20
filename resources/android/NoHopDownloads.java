package com.wails.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import org.json.JSONObject;

/** Exports only completed SFTP staging files, using the system document provider. */
public final class NoHopDownloads {
    private static final int SAVE_REQUEST = 62041;
    private final Activity activity;
    private final WebView webView;
    private File source;
    private String requestId;
    private boolean copying;
    private boolean destroyed;

    public NoHopDownloads(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    private File validate(String path) throws Exception {
        File file = new File(path).getCanonicalFile();
        File parent = file.getParentFile();
        File root = new File(activity.getFilesDir(), "sftp-downloads").getCanonicalFile();
        if (parent == null || !root.equals(parent.getParentFile()) ||
                !parent.getName().startsWith("download-") || !file.isFile()) {
            throw new IllegalArgumentException("无效的下载临时文件");
        }
        return file;
    }

    @JavascriptInterface
    public void saveFile(String id, String path) {
        activity.runOnUiThread(() -> {
            File candidate = null;
            try {
                candidate = validate(path);
                if (destroyed || source != null) throw new IllegalStateException("另一个文件正在保存");
                source = candidate;
                requestId = id;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                String mime = URLConnection.guessContentTypeFromName(source.getName());
                intent.setType(mime == null ? "application/octet-stream" : mime);
                intent.putExtra(Intent.EXTRA_TITLE, source.getName());
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                activity.startActivityForResult(intent, SAVE_REQUEST);
            } catch (Exception error) {
                if (id.equals(requestId)) finish("", error.toString());
                else {
                    if (candidate != null && !candidate.equals(source)) cleanup(candidate);
                    respond(id, "", error.toString());
                }
            }
        });
    }

    public boolean onActivityResult(int code, int result, Intent data) {
        if (code != SAVE_REQUEST) return false;
        if (source == null || copying) return true;
        if (result != Activity.RESULT_OK || data == null || data.getData() == null) {
            finish("", ""); // Cancellation is a normal result.
            return true;
        }
        final Uri uri = data.getData();
        if (!"content".equals(uri.getScheme())) {
            finish("", "文件提供方返回了无效的保存位置");
            return true;
        }
        final File input = source;
        copying = true;
        // Never copy large files on the Activity/UI thread, or through the JS bridge.
        new Thread(() -> {
            String failure = "";
            try (FileInputStream in = new FileInputStream(input);
                 OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IllegalStateException("无法打开保存位置");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                out.flush();
            } catch (Exception error) {
                failure = "保存文件失败：" + error;
                // ACTION_CREATE_DOCUMENT creates a new document; remove partial exports.
                try { android.provider.DocumentsContract.deleteDocument(activity.getContentResolver(), uri); }
                catch (Exception ignored) { }
            }
            final String error = failure;
            activity.runOnUiThread(() -> finish(error.isEmpty() ? uri.toString() : "", error));
        }, "nohop-file-export").start();
        return true;
    }

    private void finish(String destination, String error) {
        String id = requestId;
        if (source != null) cleanup(source);
        source = null;
        requestId = null;
        copying = false;
        if (id != null) respond(id, destination, error);
    }

    private static void cleanup(File file) {
        file.delete();
        file.getParentFile().delete();
    }

    private void respond(String id, String destination, String error) {
        if (destroyed) return;
        try {
            JSONObject result = new JSONObject();
            result.put("id", id);
            result.put("destination", destination);
            result.put("error", error);
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('nohop:download-export', {detail:" + result + "}));", null);
        } catch (Exception ignored) { }
    }

    public void destroy() {
        destroyed = true;
        if (!copying) finish("", "");
    }
}
