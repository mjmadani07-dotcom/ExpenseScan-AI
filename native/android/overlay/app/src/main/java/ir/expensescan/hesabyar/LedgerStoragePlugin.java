package ir.expensescan.hesabyar;

import android.content.ContentValues;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "LedgerStorage")
public class LedgerStoragePlugin extends Plugin {
    private static final String DB_NAME = "expensescan.sqlite";
    private static final int SCHEMA = 1;
    private static final int MAX_PAYLOAD = 32 * 1024 * 1024;

    private SQLiteDatabase open() {
        return getContext().openOrCreateDatabase(DB_NAME, android.content.Context.MODE_PRIVATE, null);
    }

    private String checkedPayload(PluginCall call, String key) throws Exception {
        String payload = call.getString(key);
        if (payload == null || payload.length() > MAX_PAYLOAD) throw new IllegalArgumentException("Invalid or oversized ledger payload");
        JSONObject obj = new JSONObject(payload);
        if (!obj.has("ledger") || !obj.has("draft")) throw new IllegalArgumentException("Invalid ledger snapshot");
        return payload;
    }

    private String readPayload(SQLiteDatabase db) {
        // A scalar statement avoids CursorWindow size limitations for a large snapshot.
        try (SQLiteStatement stmt = db.compileStatement("SELECT payload FROM ledger_state WHERE id=1")) {
            return stmt.simpleQueryForString();
        }
    }

    @PluginMethod public synchronized void initialize(PluginCall call) {
        try {
            String initial = checkedPayload(call, "initialPayload");
            try (SQLiteDatabase db = open()) {
                db.beginTransaction();
                try {
                    int version = db.getVersion();
                    if (version == 0) {
                        db.execSQL("CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), payload TEXT NOT NULL)");
                        ContentValues values = new ContentValues();
                        values.put("id",1); values.put("revision",0); values.put("payload",initial);
                        db.insertOrThrow("ledger_state",null,values);
                        db.setVersion(SCHEMA);
                    } else if (version != SCHEMA) throw new IllegalStateException("Unsupported database schema");
                    readPayload(db);
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
            call.resolve();
        } catch (Exception ex) { call.reject("SQLite initialization failed; existing data was not reset."); }
    }

    @PluginMethod public synchronized void read(PluginCall call) {
        try (SQLiteDatabase db = open()) {
            if (db.getVersion() != SCHEMA) throw new IllegalStateException("Unsupported database schema");
            JSObject result = new JSObject();
            db.beginTransaction();
            try {
                try (SQLiteStatement stmt = db.compileStatement("SELECT revision FROM ledger_state WHERE id=1")) {
                    result.put("revision",stmt.simpleQueryForLong());
                }
                result.put("payload",readPayload(db));
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            call.resolve(result);
        } catch (Exception ex) { call.reject("SQLite read failed; existing data was preserved."); }
    }

    @PluginMethod public synchronized void compareAndSwap(PluginCall call) {
        try {
            Long revision = call.getLong("revision");
            if (revision == null || revision < 0) throw new IllegalArgumentException("Invalid revision");
            String payload = checkedPayload(call,"payload");
            int changes;
            try (SQLiteDatabase db = open()) {
                if (db.getVersion() != SCHEMA) throw new IllegalStateException("Unsupported database schema");
                ContentValues values = new ContentValues();
                values.put("payload",payload); values.put("revision",revision+1);
                changes = db.update("ledger_state",values,"id=1 AND revision=?",new String[]{Long.toString(revision)});
            }
            JSObject result = new JSObject(); result.put("committed",changes==1); call.resolve(result);
        } catch (Exception ex) { call.reject("SQLite write failed; no success was reported."); }
    }

    @PluginMethod public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> {getActivity().moveTaskToBack(true);call.resolve();});
    }
}
