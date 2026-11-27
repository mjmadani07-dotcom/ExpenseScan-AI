package ir.expensescan.hesabyar;

import android.content.ContentValues;
import android.content.Intent;
import android.app.Activity;
import android.app.KeyguardManager;
import android.os.SystemClock;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
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
    private static final int SCHEMA = 2;
    private static final String LEDGER_KEY = "expensescan.ledger.aes.v1";
    private static final String VAULT_KEY = "expensescan.vault.aes.v1";
    private static final String PREFIX = "gcm1:";
    private static final int MAX_PAYLOAD = 32 * 1024 * 1024;

    private static final long IDLE_MS=5*60*1000L;
    private static final long BACKGROUND_MS=30*1000L;
    private long lastActivity=0, stoppedAt=0;
    private boolean unlocked=false, foreground=true, authPending=false;

    private KeyguardManager keyguard(){return (KeyguardManager)getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);}
    private synchronized boolean sessionValid(){
        long now=SystemClock.elapsedRealtime();
        if(!unlocked || !keyguard().isDeviceSecure() || now-lastActivity>=IDLE_MS || (stoppedAt!=0 && now-stoppedAt>=BACKGROUND_MS)) unlocked=false;
        return unlocked;
    }
    private synchronized boolean requireSession(PluginCall call){
        if(!sessionValid() || !foreground){call.reject("App locked; authenticate again","APP_LOCKED");return false;}
        return true;
    }
    @PluginMethod public synchronized void sessionStatus(PluginCall call){
        JSObject r=new JSObject();r.put("unlocked",sessionValid() && foreground);r.put("deviceSecure",keyguard().isDeviceSecure());call.resolve(r);
    }
    @PluginMethod public synchronized void noteActivity(PluginCall call){
        if(!requireSession(call))return;
        lastActivity=SystemClock.elapsedRealtime();call.resolve();
    }
    @PluginMethod public synchronized void lockApp(PluginCall call){unlocked=false;call.resolve();}
    @Override protected synchronized void handleOnStop(){foreground=false;stoppedAt=SystemClock.elapsedRealtime();}
    @Override protected synchronized void handleOnResume(){sessionValid();foreground=true;stoppedAt=0;}
    @PluginMethod public synchronized void unlockApp(PluginCall call){
        if(authPending){call.reject("Authentication already in progress");return;}
        if(!keyguard().isDeviceSecure()){call.reject("Set a secure screen lock in Android settings first","NO_DEVICE_LOCK");return;}
        Intent prompt=keyguard().createConfirmDeviceCredentialIntent("حساب‌یار","برای ورود به دفتر مالی، قفل گوشی را تأیید کنید.");
        if(prompt==null){call.reject("Device credential prompt unavailable");return;}
        authPending=true;
        try{startActivityForResult(call,prompt,"unlockResult");}
        catch(Exception ex){authPending=false;call.reject("Cannot open credential prompt");}
    }
    @ActivityCallback private synchronized void unlockResult(PluginCall call,ActivityResult result){
        authPending=false;
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || !keyguard().isDeviceSecure()){unlocked=false;call.reject("Authentication cancelled or failed");return;}
        unlocked=true;lastActivity=SystemClock.elapsedRealtime();stoppedAt=0;foreground=true;call.resolve();
    }

    private SQLiteDatabase open() {
        return getContext().openOrCreateDatabase(DB_NAME, android.content.Context.MODE_PRIVATE, null);
    }

    private SecretKey key(String alias, boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(alias)) return (SecretKey)ks.getKey(alias,null);
        if (!create) throw new IllegalStateException("Encryption key unavailable");
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return kg.generateKey();
    }
    private String encrypt(String alias,String plain,boolean create) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,key(alias,create));
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        return PREFIX+Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    }
    private String decrypt(String alias,String encoded) throws Exception {
        if (!encoded.startsWith(PREFIX)) throw new IllegalStateException("Invalid encrypted payload");
        String[] parts=encoded.split(":",3);
        if(parts.length!=3)throw new IllegalStateException("Invalid encrypted payload");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(alias,false),new GCMParameterSpec(128,Base64.decode(parts[1],Base64.NO_WRAP)));
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(parts[2],Base64.NO_WRAP)),StandardCharsets.UTF_8);
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
        if(!requireSession(call))return;
        try {
            String initial = checkedPayload(call, "initialPayload");
            try (SQLiteDatabase db = open()) {
                db.beginTransaction();
                try {
                    int version = db.getVersion();
                    if (version == 0) {
                        db.execSQL("CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), payload TEXT NOT NULL)");
                        ContentValues values = new ContentValues();
                        values.put("id",1); values.put("revision",0); values.put("payload",encrypt(LEDGER_KEY,initial,true));
                        db.insertOrThrow("ledger_state",null,values);
                        db.setVersion(SCHEMA);
                    } else if (version == 1) {
                        String old=readPayload(db);
                        JSONObject check=new JSONObject(old);
                        if(!check.has("ledger")||!check.has("draft"))throw new IllegalStateException("Invalid old snapshot");
                        ContentValues encrypted=new ContentValues();
                        encrypted.put("payload",encrypt(LEDGER_KEY,old,true));
                        if(db.update("ledger_state",encrypted,"id=1",null)!=1)throw new IllegalStateException("Migration failed");
                        db.setVersion(SCHEMA);
                    } else if (version != SCHEMA) throw new IllegalStateException("Unsupported database schema");
                    decrypt(LEDGER_KEY,readPayload(db));
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
            call.resolve();
        } catch (Exception ex) { call.reject("SQLite initialization failed; existing data was not reset."); }
    }

    @PluginMethod public synchronized void read(PluginCall call) {
        if(!requireSession(call))return;
        try (SQLiteDatabase db = open()) {
            if (db.getVersion() != SCHEMA) throw new IllegalStateException("Unsupported database schema");
            JSObject result = new JSObject();
            db.beginTransaction();
            try {
                try (SQLiteStatement stmt = db.compileStatement("SELECT revision FROM ledger_state WHERE id=1")) {
                    result.put("revision",stmt.simpleQueryForLong());
                }
                result.put("payload",decrypt(LEDGER_KEY,readPayload(db)));
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            call.resolve(result);
        } catch (Exception ex) { call.reject("SQLite read failed; existing data was preserved."); }
    }

    @PluginMethod public synchronized void compareAndSwap(PluginCall call) {
        if(!requireSession(call))return;
        try {
            // Android JSON often decodes small numbers as Integer, not Long.
            String revisionText = call.getString("revision");
            if (revisionText == null || !revisionText.matches("[0-9]{1,16}")) throw new IllegalArgumentException("Invalid revision");
            long revision = Long.parseLong(revisionText);
            if (revision > 9007199254740990L) throw new IllegalArgumentException("Revision exceeds JS safe range");
            String payload = checkedPayload(call,"payload");
            int changes;
            try (SQLiteDatabase db = open()) {
                if (db.getVersion() != SCHEMA) throw new IllegalStateException("Unsupported database schema");
                ContentValues values = new ContentValues();
                values.put("payload",encrypt(LEDGER_KEY,payload,false)); values.put("revision",revision+1);
                changes = db.update("ledger_state",values,"id=1 AND revision=?",new String[]{Long.toString(revision)});
            }
            JSObject result = new JSObject(); result.put("committed",changes==1); call.resolve(result);
        } catch (Exception ex) { call.reject("SQLite write failed; no success was reported."); }
    }

    @PluginMethod public synchronized void loadKeys(PluginCall call) {
        if(!requireSession(call))return;
        try {
            String cipher=getContext().getSharedPreferences("secure_vault",0).getString("keys",null);
            JSObject result=new JSObject();
            result.put("keys",cipher==null?"{}":decrypt(VAULT_KEY,cipher));
            call.resolve(result);
        }catch(Exception ex){call.reject("Secure key vault unavailable; existing keys were preserved.");}
    }
    @PluginMethod public synchronized void saveKey(PluginCall call) {
        if(!requireSession(call))return;
        try {
            String provider=call.getString("provider"), value=call.getString("value");
            if(provider==null||!provider.matches("gemini|openai|openrouter")||value==null||value.length()>4096)throw new IllegalArgumentException("Invalid provider key");
            android.content.SharedPreferences prefs=getContext().getSharedPreferences("secure_vault",0);
            String old=prefs.getString("keys",null);
            JSONObject keys=new JSONObject(old==null?"{}":decrypt(VAULT_KEY,old));
            if(value.trim().isEmpty())keys.remove(provider);else keys.put(provider,value.trim());
            if(!prefs.edit().putString("keys",encrypt(VAULT_KEY,keys.toString(),old==null)).commit())throw new IllegalStateException("Vault write failed");
            JSObject result=new JSObject();result.put("keys",keys.toString());call.resolve(result);
        }catch(Exception ex){call.reject("Secure key write failed; no success was reported.");}
    }

    @PluginMethod public void saveBackupFile(PluginCall call) {saveExport(call,true);}
    @PluginMethod public void saveExportFile(PluginCall call) {saveExport(call,false);}
    private void saveExport(PluginCall call,boolean backup) {
        if(!requireSession(call))return;
        String data=call.getString("data"), name=call.getString("name"), mime=backup?"application/octet-stream":call.getString("mime");
        if(data==null||data.length()>64*1024*1024||name==null||!name.matches("[A-Za-z0-9._-]{1,100}")||mime==null||(!backup&&!mime.equals("application/json")&&!mime.equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))){call.reject("Invalid export file");return;}
        if(backup&&!name.endsWith(".esbackup")){call.reject("Invalid backup extension");return;}
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,name);
        startActivityForResult(call,intent,backup?"backupFileResult":"exportFileResult");
    }
    @ActivityCallback private void backupFileResult(PluginCall call, ActivityResult result){writeExport(call,result,true);}
    @ActivityCallback private void exportFileResult(PluginCall call, ActivityResult result){writeExport(call,result,false);}
    private void writeExport(PluginCall call,ActivityResult result,boolean backup){
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){call.reject("Export cancelled");return;}
        // Picker may have outlasted the session; do not release financial data after expiration.
        if(!sessionValid()){call.reject("App locked; unlock and export again","APP_LOCKED");return;}
        Uri uri=result.getData().getData();
        if(uri==null){call.reject("No destination selected");return;}
        try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"w")){
            if(out==null)throw new IllegalStateException("Cannot open destination");
            String data=call.getString("data");
            byte[] bytes=backup?data.getBytes(StandardCharsets.UTF_8):Base64.decode(data,Base64.DEFAULT);
            out.write(bytes);out.flush();
        }catch(Exception ex){call.reject("File write failed");return;}
        call.resolve();
    }

    @PluginMethod public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> {getActivity().moveTaskToBack(true);call.resolve();});
    }
}
