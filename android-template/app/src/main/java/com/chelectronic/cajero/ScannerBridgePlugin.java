package com.chelectronic.cajero;

import android.view.InputDevice;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

@CapacitorPlugin(name = "ScannerBridge")
public class ScannerBridgePlugin extends Plugin {
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        MainActivity.setScannerActive(enabled);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        boolean connected = false;
        String deviceName = "";
        for (int deviceId : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(deviceId);
            if (device == null || device.isVirtual()) continue;
            int sources = device.getSources();
            if ((sources & InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD) {
                connected = true;
                deviceName = device.getName();
                break;
            }
        }
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("connected", connected);
        result.put("deviceName", deviceName);
        call.resolve(result);
    }
}
