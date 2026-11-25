package com.chelectronic.cajero;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "FilePicker")
public class FilePickerPlugin extends Plugin {
    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "handlePickedFile");
    }

    @ActivityCallback
    private void handlePickedFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Selección de archivo cancelada.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) { call.reject("No se recibió un archivo."); return; }
        try {
            String filename = "archivo.zip";
            Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (cursor.moveToFirst() && nameIndex >= 0) filename = cursor.getString(nameIndex);
                cursor.close();
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IllegalStateException("No se pudo abrir el archivo.");
                byte[] buffer = new byte[8192];
                int count;
                long total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 50L * 1024L * 1024L) throw new IllegalArgumentException("El archivo supera el límite de 50 MB.");
                    output.write(buffer, 0, count);
                }
            }
            JSObject response = new JSObject();
            response.put("fileName", filename);
            response.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception error) { call.reject("No se pudo leer el archivo: " + error.getMessage(), error); }
    }
}
