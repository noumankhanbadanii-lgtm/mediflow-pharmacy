package com.mediflow.pharmacy;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/** Offline Android shell. All business rules remain in the bundled, validated domain module. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://app.mediflow.local/";
    private static final int EXPORT_DOCUMENT = 1001;
    private static final int IMPORT_DOCUMENT = 1002;
    private static final int MAX_SNAPSHOT_BYTES = 1500000;
    private WebView webView;
    private StoreDatabase storeDatabase;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private String pendingExportName;
    private boolean destroyed;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        storeDatabase = new StoreDatabase();
        WebView.setWebContentsDebuggingEnabled(false);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 249, 250));
        configureWebView(webView, true);
        webView.addJavascriptInterface(new NativeStore(), "NativeStore");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isInternal(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isInternal(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // The application is a single inline asset. No external resource or API is contacted.
                Uri uri = request.getUrl();
                if (isInternal(uri) && "/api/state".equals(uri.getPath())) {
                    return jsonResponse(new NativeStore().load());
                }
                String body = "{\"error\":\"This application works offline. Use the local store adapter.\"}";
                WebResourceResponse response = jsonResponse(body);
                response.setStatusCodeAndReasonPhrase(403, "Offline");
                return response;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(intent, IMPORT_DOCUMENT); }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("No document picker is available."); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mimeType, length) -> toast("Use the app's Export or Print buttons to save files."));
        setContentView(webView);
        try {
            String html = readAsset("index.html");
            String policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">";
            html = html.replaceFirst("(?i)<head>", "<head>" + policy);
            webView.loadDataWithBaseURL(ORIGIN, html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            webView.loadDataWithBaseURL(ORIGIN, "<h2>MediFlow could not open</h2><p>The bundled app files are missing. Please reinstall the complete APK.</p>", "text/html", "UTF-8", null);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view, boolean javascript) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(javascript);
        settings.setDomStorageEnabled(javascript);
        settings.setAllowFileAccess(false);
        // Content URIs are only supplied by the user-controlled Android document picker.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setTextZoom(100);
    }

    private static boolean isInternal(Uri uri) {
        return "https".equals(uri.getScheme()) && "app.mediflow.local".equals(uri.getHost());
    }
    private static WebResourceResponse jsonResponse(String json) {
        HashMap<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("application/json", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }
    private String readAsset(String name) throws Exception {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString("UTF-8");
        }
    }
    private void toast(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }
    private String errorJson(String message, long version) {
        try { return new JSONObject().put("ok", false).put("error", message).put("version", version).toString(); }
        catch (Exception impossible) { return "{\"ok\":false,\"error\":\"Local storage error.\"}"; }
    }

    private final class StoreDatabase extends SQLiteOpenHelper {
        StoreDatabase() { super(MainActivity.this, "mediflow_store.db", null, 1); }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE store_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, data TEXT NOT NULL)");
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Future schema migrations must preserve existing store data.
        }
    }

    public final class NativeStore {
        @JavascriptInterface public synchronized String load() {
            try (Cursor cursor = storeDatabase.getReadableDatabase().rawQuery("SELECT version, data FROM store_snapshot WHERE id = 1", null)) {
                if (!cursor.moveToFirst()) return "{\"state\":null,\"version\":0}";
                return new JSONObject().put("state", new JSONObject(cursor.getString(1))).put("version", cursor.getLong(0)).toString();
            } catch (Exception error) {
                return errorJson("Local data could not be opened. Do not uninstall the app; retry or restore a backup.", -1);
            }
        }
        @JavascriptInterface public synchronized String save(long expectedVersion, String data) {
            if (data == null || data.getBytes(StandardCharsets.UTF_8).length > MAX_SNAPSHOT_BYTES)
                return errorJson("Store capacity reached. Export a backup before adding more records.", expectedVersion);
            try {
                JSONObject state = new JSONObject(data);
                if (state.optInt("schemaVersion", -1) != 1) return errorJson("Unsupported store data format.", expectedVersion);
            } catch (Exception error) { return errorJson("The store data is invalid and was not saved.", expectedVersion); }
            SQLiteDatabase db;
            try { db = storeDatabase.getWritableDatabase(); }
            catch (Exception error) { return errorJson("Local storage is unavailable. No changes were saved.", expectedVersion); }
            boolean transactionStarted = false;
            try {
                db.beginTransaction(); transactionStarted = true;
                long currentVersion = 0; boolean exists;
                try (Cursor cursor = db.rawQuery("SELECT version FROM store_snapshot WHERE id = 1", null)) {
                    exists = cursor.moveToFirst();
                    if (exists) currentVersion = cursor.getLong(0);
                }
                if (expectedVersion < 0 || currentVersion != expectedVersion)
                    return errorJson("The store changed. Reload and retry this action.", currentVersion);
                long nextVersion = currentVersion + 1;
                ContentValues values = new ContentValues();
                values.put("version", nextVersion); values.put("data", data);
                if (exists) db.update("store_snapshot", values, "id = ?", new String[]{"1"});
                else { values.put("id", 1); db.insertOrThrow("store_snapshot", null, values); }
                db.setTransactionSuccessful();
                return new JSONObject().put("ok", true).put("version", nextVersion).toString();
            } catch (Exception error) {
                return errorJson("The device could not save this action. Check free storage and retry.", expectedVersion);
            } finally { if (transactionStarted) db.endTransaction(); }
        }
        @JavascriptInterface public String exportFile(String name, String content, String mime) {
            if (content == null || content.getBytes(StandardCharsets.UTF_8).length > 10000000)
                return errorJson("Export is too large.", -1);
            final String safeName = (name == null ? "MediFlow-backup.json" : name).replaceAll("[^a-zA-Z0-9._-]", "_");
            final String safeMime = mime != null && mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+") ? mime : "application/octet-stream";
            runOnUiThread(() -> {
                if (pendingExport != null) { dispatchExport(false, "Another export is already open.", safeName); return; }
                pendingExport = content.getBytes(StandardCharsets.UTF_8); pendingExportName = safeName;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(safeMime); intent.putExtra(Intent.EXTRA_TITLE, safeName);
                try { startActivityForResult(intent, EXPORT_DOCUMENT); }
                catch (Exception error) { pendingExport = null; pendingExportName = null; dispatchExport(false, "No document picker is available.", safeName); }
            });
            return "{\"ok\":true,\"pending\":true}";
        }
        @JavascriptInterface public void printReceipt(String html) {
            if (html == null || html.getBytes(StandardCharsets.UTF_8).length > 500000) { toast("Receipt is too large to print."); return; }
            runOnUiThread(() -> startPrint(html));
        }
    }

    private void dispatchExport(boolean ok, String error, String name) {
        if (destroyed) return;
        try {
            JSONObject detail = new JSONObject().put("ok", ok).put("name", name == null ? "" : name);
            if (error != null) detail.put("error", error);
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('native-export',{detail:" + detail + "}));", null);
        } catch (Exception ignored) { }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_DOCUMENT) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(resultCode == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
                fileCallback = null;
            }
        } else if (requestCode == EXPORT_DOCUMENT) {
            byte[] bytes = pendingExport; String name = pendingExportName; pendingExport = null; pendingExportName = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || bytes == null) {
                dispatchExport(false, "Export cancelled.", name); return;
            }
            Uri destination = data.getData();
            new Thread(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IllegalStateException("Document is unavailable");
                    output.write(bytes); output.flush();
                    runOnUiThread(() -> { dispatchExport(true, null, name); toast("Saved " + name); });
                } catch (Exception error) {
                    runOnUiThread(() -> dispatchExport(false, "The file could not be saved. Choose another location.", name));
                }
            }, "MediFlow-export").start();
        }
    }
    private void startPrint(String html) {
        final WebView receiptView = new WebView(this);
        configureWebView(receiptView, false);
        receiptView.setWebViewClient(new WebViewClient() {
            private boolean requested;
            @Override public void onPageFinished(WebView view, String url) {
                if (requested) return; requested = true;
                PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (manager == null) { receiptView.destroy(); toast("Printing is unavailable on this device."); return; }
                PrintDocumentAdapter delegate = receiptView.createPrintDocumentAdapter("MediFlow receipt");
                PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                    @Override public void onStart() { delegate.onStart(); }
                    @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                        delegate.onLayout(oldAttributes, newAttributes, signal, callback, extras);
                    }
                    @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal signal, WriteResultCallback callback) {
                        delegate.onWrite(pages, destination, signal, callback);
                    }
                    @Override public void onFinish() { delegate.onFinish(); receiptView.destroy(); }
                };
                try { manager.print("MediFlow receipt", adapter, new PrintAttributes.Builder().build()); }
                catch (Exception error) { receiptView.destroy(); toast("The print dialog could not open."); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
        });
        receiptView.loadDataWithBaseURL(ORIGIN, html, "text/html", "UTF-8", null);
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (webView != null) { webView.removeJavascriptInterface("NativeStore"); webView.destroy(); }
        if (storeDatabase != null) storeDatabase.close();
        super.onDestroy();
    }
}
