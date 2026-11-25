package com.chelectronic.cajero;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static MainActivity instance;
    private volatile boolean scannerEnabled = false;
    private final StringBuilder scannerBuffer = new StringBuilder();
    private final Set<Integer> scannerCapturedKeys = new HashSet<>();
    private long lastScannerKeyAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SQLiteBridgePlugin.class);
        registerPlugin(ScannerBridgePlugin.class);
        registerPlugin(FilePickerPlugin.class);
        super.onCreate(savedInstanceState);
        instance = this;
    }

    public static void setScannerActive(boolean enabled) {
        MainActivity current = instance;
        if (current != null) {
            current.runOnUiThread(() -> {
                current.scannerEnabled = enabled;
                current.scannerBuffer.setLength(0);
                current.scannerCapturedKeys.clear();
                current.lastScannerKeyAt = 0L;
            });
        }
    }

    private void sendBarcode(String code) {
        if (code == null || code.length() < 4 || getBridge() == null) return;
        final String escaped = JSONObject.quote(code);
        runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('scanner:code',{detail:{code:" + escaped + "}}));",
                    null
                );
            }
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (!scannerEnabled) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_UP) {
            return scannerCapturedKeys.remove(keyCode) || super.dispatchKeyEvent(event);
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event);
        if (event.getRepeatCount() > 0) return scannerCapturedKeys.contains(keyCode) || super.dispatchKeyEvent(event);

        if (keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            scannerCapturedKeys.add(keyCode);
            long now = System.currentTimeMillis();
            if (lastScannerKeyAt != 0L && now - lastScannerKeyAt > 100L) {
                scannerBuffer.setLength(0);
            }
            String code = scannerBuffer.toString().trim();
            scannerBuffer.setLength(0);
            lastScannerKeyAt = 0L;
            if (code.length() >= 4) sendBarcode(code);
            return true;
        }

        int unicode = event.getUnicodeChar(event.getMetaState());
        if (unicode > 0 && !Character.isISOControl(unicode)) {
            scannerCapturedKeys.add(keyCode);
            long now = System.currentTimeMillis();
            if (lastScannerKeyAt != 0L && now - lastScannerKeyAt > 100L) {
                scannerBuffer.setLength(0);
            }
            lastScannerKeyAt = now;
            if (scannerBuffer.length() < 128) scannerBuffer.append((char) unicode);
            return true;
        }
        // No consumir teclas ajenas al contenido textual del escáner (volumen, navegación, etc.).
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        scannerEnabled = false;
        scannerCapturedKeys.clear();
        super.onDestroy();
    }
}
