package ir.expensescan.hesabyar;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LedgerDeviceTest {
    private static JSONObject row(String table,String id,String parent,String data)throws Exception {
        return new JSONObject().put("table",table).put("id",id).put("parent",parent==null?JSONObject.NULL:parent).put("data",data);
    }
    private static String value(SQLiteDatabase db,String query){
        try(SQLiteStatement s=db.compileStatement(query)){return s.simpleQueryForString();}
    }
    private static LedgerTables.Codec codec(SecretKey key,String alias){
        return new LedgerTables.Codec(){
            public String seal(String plain)throws Exception{
                Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);c.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
                return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(plain.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
            }
            public String open(String cipher)throws Exception{
                String[] parts=cipher.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));c.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
                return new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
            }
        };
    }
    @Test public void actualSQLiteAndKeystoreMigrationRollbackAndActiveReads()throws Exception{
        Context ctx=ApplicationProvider.getApplicationContext();
        String name="instrumentation-"+UUID.randomUUID()+".sqlite",alias="expensescan.instrumentation."+UUID.randomUUID();
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        try{
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            gen.generateKey();
            LedgerTables.Codec codec=codec((SecretKey)ks.getKey(alias,null),alias);
            String legacy=codec.seal("{\"ledger\":{},\"draft\":null}");
            try(SQLiteDatabase db=ctx.openOrCreateDatabase(name,Context.MODE_PRIVATE,null)){
                db.setForeignKeyConstraintsEnabled(true);
                db.execSQL("CREATE TABLE ledger_state (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL)");
                db.execSQL("INSERT INTO ledger_state VALUES (1,7,?)",new Object[]{legacy});
                db.setVersion(2);
                // Failed migration must preserve the old encrypted table and version.
                db.beginTransaction();
                try{
                    try{
                        LedgerTables.migrateLegacy(db,7,new JSONArray().put(row("meta","state",null,"{}")).put(row("line_items","bad","missing","{}")),codec);
                        fail("Foreign key violation should abort migration");
                    }catch(android.database.sqlite.SQLiteException expected){}
                }finally{db.endTransaction();}
                assertEquals(2,db.getVersion());assertEquals(legacy,value(db,"SELECT payload FROM ledger_state WHERE id=1"));
                JSONArray rows=new JSONArray().put(row("meta","state",null,"{}")).put(row("expenses","e",null,"{\"title\":\"private-test\"}")).put(row("line_items","l","e","{}")).put(row("recoveries","r",null,"{\"marker\":\"recovery\"}")).put(row("approval","last",null,"{}"));
                db.beginTransaction();
                try{LedgerTables.migrateLegacy(db,7,rows,codec);db.execSQL("UPDATE ledger_revision SET revision=8 WHERE id=1 AND revision=7");db.setTransactionSuccessful();}
                finally{db.endTransaction();}
                assertEquals(3,db.getVersion());assertEquals(8,LedgerTables.revision(db,"ledger_revision"));
                assertFalse(value(db,"SELECT payload FROM ledger_expenses WHERE row_id='e'").contains("private-test"));
                LedgerTables.verifyMigration(db,rows,codec);
                JSONArray active=LedgerTables.read(db,codec,true);assertEquals(3,active.length());
                for(int i=0;i<active.length();i++){String table=active.getJSONObject(i).getString("table");assertFalse(table.equals("recoveries")||table.equals("approval"));}
                db.beginTransaction();
                try{
                    LedgerTables.apply(db,new JSONArray(),new JSONArray().put(row("expenses","e",null,"{\"title\":\"changed\"}")),codec);
                    // Deliberately omit setTransactionSuccessful() to simulate rollback.
                }finally{db.endTransaction();}
                LedgerTables.verifyMigration(db,rows,codec);
                assertEquals(8,LedgerTables.revision(db,"ledger_revision"));
            }
            try(SQLiteDatabase reopened=ctx.openOrCreateDatabase(name,Context.MODE_PRIVATE,null)){
                assertEquals(3,reopened.getVersion());assertEquals(5,LedgerTables.read(reopened,codec).length());
            }
        }finally{ctx.deleteDatabase(name);if(ks.containsAlias(alias))ks.deleteEntry(alias);}
    }
    @Test public void installedAppStartsAtSecureLockScreen()throws Exception{
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->assertTrue((activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0));
            boolean locked=false;
            for(int i=0;i<30&&!locked;i++){
                CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
                scenario.onActivity(activity->{
                    if(activity.getBridge()==null||activity.getBridge().getWebView()==null){latch.countDown();return;}
                    activity.getBridge().getWebView().evaluateJavascript("Boolean(document.body && document.body.innerText.includes('حساب‌یار قفل است'))",v->{result.set(v);latch.countDown();});
                });
                if(latch.await(2,TimeUnit.SECONDS)&&"true".equals(result.get()))locked=true;
                else Thread.sleep(1000);
            }
            assertTrue("The installed native app did not show its lock screen",locked);
        }
    }
}
