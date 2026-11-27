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
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import android.util.AtomicFile;
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
import org.json.JSONArray;

@CapacitorPlugin(name = "LedgerStorage")
public class LedgerStoragePlugin extends Plugin {
    private static final String DB_NAME = "expensescan.sqlite";
    private static final int SCHEMA = 2;
    private static final String LEDGER_KEY = "expensescan.ledger.aes.v1";
    private static final String VAULT_KEY = "expensescan.vault.aes.v1";
    private static final String ATTACHMENT_KEY = "expensescan.attachment.aes.v1";
    private static final int MAX_ATTACHMENT = 12*1024*1024;
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
        JSObject r=new JSObject();r.put("unlocked",sessionValid());r.put("deviceSecure",keyguard().isDeviceSecure());r.put("biometricAvailable",keyguard().isDeviceSecure()&&BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)==BiometricManager.BIOMETRIC_SUCCESS);call.resolve(r);
    }
    @PluginMethod public synchronized void noteActivity(PluginCall call){
        if(!requireSession(call))return;
        lastActivity=SystemClock.elapsedRealtime();call.resolve();
    }
    @PluginMethod public synchronized void lockApp(PluginCall call){unlocked=false;call.resolve();}
    @Override protected synchronized void handleOnStop(){foreground=false;stoppedAt=SystemClock.elapsedRealtime();}
    @Override protected synchronized void handleOnResume(){sessionValid();foreground=true;stoppedAt=0;}
    @PluginMethod public synchronized void unlockBiometric(PluginCall call){
        if(authPending){call.reject("Authentication already in progress");return;}
        if(!keyguard().isDeviceSecure()||BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)!=BiometricManager.BIOMETRIC_SUCCESS){
            call.reject("Strong biometric authentication unavailable; use device credential","BIOMETRIC_UNAVAILABLE");return;
        }
        authPending=true;
        getActivity().runOnUiThread(()->{
            try{
                BiometricPrompt prompt=new BiometricPrompt(getActivity(),ContextCompat.getMainExecutor(getContext()),new BiometricPrompt.AuthenticationCallback(){
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){
                        synchronized(LedgerStoragePlugin.this){
                            if(!authPending)return;
                            authPending=false;
                            if(!keyguard().isDeviceSecure()||!foreground){unlocked=false;call.reject("Authentication session expired");return;}
                            unlocked=true;lastActivity=SystemClock.elapsedRealtime();stoppedAt=0;call.resolve();
                        }
                    }
                    @Override public void onAuthenticationError(int code,CharSequence message){
                        synchronized(LedgerStoragePlugin.this){
                            if(!authPending)return;
                            authPending=false;unlocked=false;
                            call.reject("Biometric authentication ended; use device credential if needed","BIOMETRIC_FAILED");
                        }
                    }
                });
                prompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle("حساب‌یار").setSubtitle("ورود امن با حسگر بیومتریک دستگاه").setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("انصراف").build());
            }catch(Exception ex){synchronized(LedgerStoragePlugin.this){authPending=false;unlocked=false;call.reject("Biometric prompt unavailable");}}
        });
    }
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
        SQLiteDatabase db=getContext().openOrCreateDatabase(DB_NAME, android.content.Context.MODE_PRIVATE, null);
        db.setForeignKeyConstraintsEnabled(true);return db;
    }
    private LedgerTables.Codec rowCodec(){return new LedgerTables.Codec(){
        public String seal(String plain)throws Exception{return encrypt(LEDGER_KEY,plain,false);}
        public String open(String cipher)throws Exception{return decrypt(LEDGER_KEY,cipher);}
    };}

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
                    } else if (version != SCHEMA && version!=LedgerTables.VERSION) throw new IllegalStateException("Unsupported database schema");
                    if(db.getVersion()==SCHEMA)decrypt(LEDGER_KEY,readPayload(db));
                    else LedgerTables.revision(db,"ledger_revision");
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
            call.resolve();
        } catch (Exception ex) { call.reject("SQLite initialization failed; existing data was not reset."); }
    }

    @PluginMethod public synchronized void read(PluginCall call) {
        if(!requireSession(call))return;
        try (SQLiteDatabase db = open()) {
            int schema=db.getVersion();
            if(schema!=SCHEMA&&schema!=LedgerTables.VERSION)throw new IllegalStateException("Unsupported database schema");
            JSObject result=new JSObject();
            db.beginTransaction();
            try {
                result.put("schema",schema);
                if(schema==SCHEMA){
                    result.put("revision",LedgerTables.revision(db,"ledger_state"));
                    result.put("payload",decrypt(LEDGER_KEY,readPayload(db)));
                }else{
                    result.put("revision",LedgerTables.revision(db,"ledger_revision"));
                    result.put("rows",LedgerTables.read(db,rowCodec()).toString());
                }
                db.setTransactionSuccessful();
            }finally{db.endTransaction();}
            call.resolve(result);
        }catch(Exception ex){call.reject("SQLite read failed; existing data was preserved.");}
    }

    @PluginMethod public synchronized void commitRows(PluginCall call){
        if(!requireSession(call))return;
        try{
            String revisionText=call.getString("revision"),raw=call.getString("patch");
            if(revisionText==null||!revisionText.matches("[0-9]{1,16}")||raw==null||raw.length()>64L*1024*1024)throw new IllegalArgumentException("Invalid row change");
            long revision=Long.parseLong(revisionText);
            if(revision>9007199254740990L)throw new IllegalArgumentException("Revision exceeds JS safe range");
            JSONObject patch=new JSONObject(raw);
            JSONArray upserts=patch.getJSONArray("upserts"),deletes=patch.getJSONArray("deletes");
            boolean migration=Boolean.TRUE.equals(call.getBoolean("migration",false)),committed=false;
            try(SQLiteDatabase db=open()){
                db.beginTransaction();
                try{
                    int schema=db.getVersion();
                    if(schema!=SCHEMA&&schema!=LedgerTables.VERSION)throw new IllegalStateException("Unsupported schema");
                    if(migration!=(schema==SCHEMA))throw new IllegalStateException("Migration state mismatch");
                    long actual=LedgerTables.revision(db,migration?"ledger_state":"ledger_revision");
                    if(actual==revision){
                        if(migration){
                            if(deletes.length()!=0)throw new IllegalArgumentException("Invalid migration");
                            LedgerTables.create(db,revision);
                        }
                        LedgerTables.apply(db,deletes,upserts,rowCodec());
                        ContentValues v=new ContentValues();v.put("revision",revision+1);
                        if(db.update("ledger_revision",v,"id=1 AND revision=?",new String[]{revisionText})!=1)throw new IllegalStateException("Revision changed");
                        if(migration){
                            // Round-trip is checked by TypeScript before sending full migration rows.
                            // All DDL/data writes and the legacy table removal share one transaction.
                            LedgerTables.verifyMigration(db,upserts,rowCodec());
                            db.execSQL("DROP TABLE ledger_state");db.setVersion(LedgerTables.VERSION);
                        }
                        db.setTransactionSuccessful();committed=true;
                    }
                }finally{db.endTransaction();}
            }
            JSObject result=new JSObject();result.put("committed",committed);call.resolve(result);
        }catch(Exception ex){call.reject("SQLite transaction failed; previous committed data was preserved.");}
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

    private AtomicFile attachmentFile(String id) throws Exception {
        if(id==null||!id.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid attachment ID");
        File dir=new File(getContext().getFilesDir(),"attachments");
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException("Attachment directory unavailable");
        return new AtomicFile(new File(dir,id+".enc"));
    }
    private void verifyAttachment(String id,String data)throws Exception{
        if(data==null||data.length()>((MAX_ATTACHMENT+2)/3)*4)throw new IllegalArgumentException("Invalid attachment length");
        byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
        if(bytes.length==0||bytes.length>MAX_ATTACHMENT)throw new IllegalArgumentException("Invalid attachment length");
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex=new StringBuilder();
        for(byte b:hash)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&0xff));
        if(!id.equals(hex.toString()))throw new IllegalStateException("Attachment digest mismatch");
    }
    private String readAttachmentData(AtomicFile file,String id)throws Exception{
        if(file.getBaseFile().length()>24L*1024*1024)throw new IllegalStateException("Attachment too large");
        String data=decrypt(ATTACHMENT_KEY,new String(file.readFully(),StandardCharsets.UTF_8));
        verifyAttachment(id,data);return data;
    }
    @PluginMethod public synchronized void putAttachment(PluginCall call){
        if(!requireSession(call))return;
        try{
            String id=call.getString("id"),data=call.getString("data");
            AtomicFile file=attachmentFile(id);verifyAttachment(id,data);
            if(file.getBaseFile().exists() || new File(file.getBaseFile().getPath()+".bak").exists()){readAttachmentData(file,id);call.resolve();return;}
            byte[] cipher=encrypt(ATTACHMENT_KEY,data,true).getBytes(StandardCharsets.UTF_8);
            FileOutputStream out=null;
            try{out=file.startWrite();out.write(cipher);file.finishWrite(out);}
            catch(Exception ex){if(out!=null)file.failWrite(out);throw ex;}
            call.resolve();
        }catch(Exception ex){call.reject("Attachment storage failed; existing documents were not overwritten.");}
    }
    @PluginMethod public synchronized void attachmentInventory(PluginCall call){
        if(!requireSession(call))return;
        try{
            File dir=new File(getContext().getFilesDir(),"attachments");
            JSONArray rows=new JSONArray();java.util.Map<String,Long> sizes=new java.util.HashMap<>();
            if(dir.exists()){
                File[] files=dir.listFiles();if(files==null)throw new IllegalStateException("Cannot list attachments");
                for(File file:files){
                    String n=file.getName();
                    if(file.isFile()&&n.matches("[a-f0-9]{64}\\.enc(\\.bak)?")){
                        String id=n.substring(0,64);sizes.put(id,sizes.getOrDefault(id,0L)+file.length());
                    }
                }
            }
            for(java.util.Map.Entry<String,Long> row:sizes.entrySet()){
                JSONObject item=new JSONObject();item.put("id",row.getKey());item.put("storedBytes",row.getValue());rows.put(item);
            }
            JSObject result=new JSObject();result.put("items",rows.toString());call.resolve(result);
        }catch(Exception ex){call.reject("Attachment inventory unavailable.");}
    }
    @PluginMethod public synchronized void readAttachment(PluginCall call){
        if(!requireSession(call))return;
        try{String id=call.getString("id");JSObject result=new JSObject();result.put("data",readAttachmentData(attachmentFile(id),id));call.resolve(result);}
        catch(Exception ex){call.reject("Attachment unavailable or damaged.");}
    }

    @PluginMethod public void saveBackupFile(PluginCall call) {saveExport(call,true);}
    @PluginMethod public void saveExportFile(PluginCall call) {saveExport(call,false);}
    private void saveExport(PluginCall call,boolean backup) {
        if(!requireSession(call))return;
        String data=call.getString("data"), name=call.getString("name"), mime=backup?"application/octet-stream":call.getString("mime");
        if(data==null||data.length()>64*1024*1024||name==null||!name.matches("[A-Za-z0-9._-]{1,100}")||mime==null||(!backup&&!mime.equals("application/json")&&!mime.equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")&&!mime.matches("application/pdf|image/(jpeg|png|webp|gif)|text/(plain|csv)"))){call.reject("Invalid export file");return;}
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
