package com.chasmet.montagevideoautomatique;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST_CODE = 2001;
    private static final String GESTION_PROVIDER_URI = "content://com.chasmet.gestiondefichiers.provider/files";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final ArrayList<Uri> sharedUris = new ArrayList<>();

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestRuntimePermissions();
        captureSharedFiles(getIntent());

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new AndroidSharedFilesBridge(), "AndroidSharedFiles");
        webView.addJavascriptInterface(new GestionnaireLibraryBridge(), "GestionnaireLibrary");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }

                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                if (acceptTypes != null && acceptTypes.length > 0) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes);
                }

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception error) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureSharedFiles(intent);
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-shared-files-ready'))", null);
        }
    }

    private void captureSharedFiles(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        sharedUris.clear();

        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) {
                persistReadPermission(uri);
                sharedUris.add(uri);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null) {
                for (Uri uri : uris) {
                    if (uri != null) {
                        persistReadPermission(uri);
                        sharedUris.add(uri);
                    }
                }
            }
        }
    }

    private void persistReadPermission(Uri uri) {
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
    }

    private String getName(Uri uri) {
        String name = "fichier-partage";
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return name;
    }

    private long getSize(Uri uri) {
        long size = 0;
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0) size = cursor.getLong(index);
            }
        } catch (Exception ignored) {}
        return size;
    }

    private String getMime(Uri uri) {
        String mime = getContentResolver().getType(uri);
        return mime != null ? mime : "application/octet-stream";
    }

    private String readUriBase64(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return "";
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } catch (Exception error) {
            return "";
        }
    }

    public class GestionnaireLibraryBridge {
        @JavascriptInterface
        public String listFilesJson() {
            try {
                JSONArray array = new JSONArray();
                Uri uri = Uri.parse(GESTION_PROVIDER_URI);
                try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor == null) return "[]";

                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    int uriIndex = cursor.getColumnIndex("uri");
                    int mimeIndex = cursor.getColumnIndex("mime");

                    while (cursor.moveToNext()) {
                        JSONObject item = new JSONObject();
                        String fileUri = uriIndex >= 0 ? cursor.getString(uriIndex) : "";
                        item.put("uri", fileUri);
                        item.put("name", nameIndex >= 0 ? cursor.getString(nameIndex) : "fichier");
                        item.put("size", sizeIndex >= 0 ? cursor.getLong(sizeIndex) : 0);
                        item.put("mimeType", mimeIndex >= 0 ? cursor.getString(mimeIndex) : "application/octet-stream");
                        array.put(item);
                    }
                }
                return array.toString();
            } catch (Exception error) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String readFileBase64(String uriString) {
            if (uriString == null || uriString.trim().isEmpty()) return "";
            return readUriBase64(Uri.parse(uriString));
        }
    }

    public class AndroidSharedFilesBridge {
        @JavascriptInterface
        public String getSharedFilesJson() {
            try {
                JSONArray array = new JSONArray();
                for (int i = 0; i < sharedUris.size(); i++) {
                    Uri uri = sharedUris.get(i);
                    JSONObject item = new JSONObject();
                    item.put("index", i);
                    item.put("name", getName(uri));
                    item.put("mimeType", getMime(uri));
                    item.put("size", getSize(uri));
                    array.put(item);
                }
                return array.toString();
            } catch (Exception error) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String readSharedFileBase64(int index) {
            if (index < 0 || index >= sharedUris.size()) return "";
            return readUriBase64(sharedUris.get(index));
        }

        @JavascriptInterface
        public void clearSharedFiles() {
            sharedUris.clear();
        }
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO
            }, 1001);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }, 1001);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != FILE_CHOOSER_REQUEST_CODE || filePathCallback == null) {
            return;
        }

        Uri[] results = null;

        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }

        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
