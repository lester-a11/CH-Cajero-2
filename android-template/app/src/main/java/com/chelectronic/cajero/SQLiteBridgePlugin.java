package com.chelectronic.cajero;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Locale;

@CapacitorPlugin(name = "SQLiteBridge")
public class SQLiteBridgePlugin extends Plugin {
    private static final String DB_NAME = "ch_cajero.db";
    private static final int DB_VERSION = 1;
    private DatabaseHelper helper;

    private static final class DatabaseHelper extends SQLiteOpenHelper {
        DatabaseHelper(Context context) { super(context, DB_NAME, null, DB_VERSION); }
        @Override public void onCreate(SQLiteDatabase db) { /* El esquema versionado se crea desde JS. */ }
        @Override public void onConfigure(SQLiteDatabase db) { super.onConfigure(db); db.setForeignKeyConstraintsEnabled(true); }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
    }

    private SQLiteDatabase db() {
        if (helper == null) helper = new DatabaseHelper(getContext());
        return helper.getWritableDatabase();
    }

    @PluginMethod
    public void open(PluginCall call) {
        try {
            db();
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("database", DB_NAME);
            call.resolve(result);
        } catch (Exception error) { call.reject("No se pudo abrir SQLite: " + error.getMessage(), error); }
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String sql = call.getString("sql");
        if (sql == null || sql.trim().isEmpty()) { call.reject("SQL vacío"); return; }
        try {
            db().execSQL(sql, bindArgs(call.getArray("values")));
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception error) { call.reject("Error SQL: " + error.getMessage(), error); }
    }

    @PluginMethod
    public void run(PluginCall call) {
        String sql = call.getString("sql");
        if (sql == null || sql.trim().isEmpty()) { call.reject("SQL vacío"); return; }
        SQLiteStatement statement = null;
        try {
            SQLiteDatabase database = db();
            statement = database.compileStatement(sql);
            bindStatement(statement, call.getArray("values"));
            String normalized = sql.trim().toUpperCase(Locale.ROOT);
            long lastId = -1L;
            int changes = 0;
            if (normalized.startsWith("INSERT")) {
                lastId = statement.executeInsert();
                changes = lastId >= 0 ? 1 : 0;
            } else if (normalized.startsWith("UPDATE") || normalized.startsWith("DELETE")) {
                changes = statement.executeUpdateDelete();
            } else {
                statement.execute();
            }
            JSObject result = new JSObject();
            result.put("changes", changes);
            result.put("lastId", lastId);
            call.resolve(result);
        } catch (Exception error) { call.reject("Error al modificar SQLite: " + error.getMessage(), error); }
        finally { if (statement != null) statement.close(); }
    }

    @PluginMethod
    public void query(PluginCall call) {
        String sql = call.getString("sql");
        if (sql == null || sql.trim().isEmpty()) { call.reject("SQL vacío"); return; }
        Cursor cursor = null;
        try {
            JSONArray raw = call.getArray("values");
            String[] args = new String[raw == null ? 0 : raw.length()];
            for (int i = 0; i < args.length; i++) {
                Object value = raw.opt(i);
                args[i] = (value == null || value == JSONObject.NULL) ? null : String.valueOf(value);
            }
            cursor = db().rawQuery(sql, args);
            JSArray rows = new JSArray();
            while (cursor.moveToNext()) {
                JSObject row = new JSObject();
                for (int i = 0; i < cursor.getColumnCount(); i++) {
                    String name = cursor.getColumnName(i);
                    switch (cursor.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL: row.put(name, JSONObject.NULL); break;
                        case Cursor.FIELD_TYPE_INTEGER: row.put(name, cursor.getLong(i)); break;
                        case Cursor.FIELD_TYPE_FLOAT: row.put(name, cursor.getDouble(i)); break;
                        case Cursor.FIELD_TYPE_BLOB: row.put(name, Base64.encodeToString(cursor.getBlob(i), Base64.NO_WRAP)); break;
                        default: row.put(name, cursor.getString(i)); break;
                    }
                }
                rows.put(row);
            }
            JSObject result = new JSObject();
            result.put("rows", rows);
            call.resolve(result);
        } catch (Exception error) { call.reject("Error al consultar SQLite: " + error.getMessage(), error); }
        finally { if (cursor != null) cursor.close(); }
    }

    private Object[] bindArgs(JSONArray values) throws JSONException {
        if (values == null) return new Object[0];
        Object[] result = new Object[values.length()];
        for (int i = 0; i < values.length(); i++) {
            Object value = values.get(i);
            result[i] = (value == JSONObject.NULL) ? null : value;
        }
        return result;
    }

    private void bindStatement(SQLiteStatement statement, JSONArray values) throws JSONException {
        if (values == null) return;
        for (int i = 0; i < values.length(); i++) {
            Object value = values.get(i);
            int index = i + 1;
            if (value == JSONObject.NULL || value == null) statement.bindNull(index);
            else if (value instanceof Boolean) statement.bindLong(index, (Boolean) value ? 1 : 0);
            else if (value instanceof Integer || value instanceof Long) statement.bindLong(index, ((Number) value).longValue());
            else if (value instanceof Number) statement.bindDouble(index, ((Number) value).doubleValue());
            else if (value instanceof byte[]) statement.bindBlob(index, (byte[]) value);
            else statement.bindString(index, String.valueOf(value));
        }
    }
}
