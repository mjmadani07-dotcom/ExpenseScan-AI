package ir.expensescan.hesabyar;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MultiLedgerDeviceTest {
    private JSONObject row(String t,String id,String parent,String data)throws Exception{return new JSONObject().put("table",t).put("id",id).put("parent",parent==null?JSONObject.NULL:parent).put("data",data);}
    private JSONObject profile(String id,String name)throws Exception{return new JSONObject().put("id",id).put("name",name).put("color","#123456").put("archived",false).put("createdAt","2026-11-27T00:00:00Z");}
    private LedgerTables.Codec codec(SecretKey key){return new LedgerTables.Codec(){
        public String seal(String p)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(p.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);}
        public String open(String p)throws Exception{String[] x=p.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(x[0],Base64.NO_WRAP)));return new String(c.doFinal(Base64.decode(x[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
    };}
    @Test public void v3MigrationScopesAndRollback()throws Exception{
        Context ctx=ApplicationProvider.getApplicationContext();String name="multi-test-"+UUID.randomUUID(),alias="multi-test-"+UUID.randomUUID();
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        try{
            KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build());
            LedgerTables.Codec codec=codec(g.generateKey());
            try(SQLiteDatabase db=ctx.openOrCreateDatabase(name,Context.MODE_PRIVATE,null)){
                db.setForeignKeyConstraintsEnabled(true);
                String hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
                JSONArray rows=new JSONArray().put(row("meta","state",null,"{}")).put(row("expenses","same",null,new JSONObject().put("header",new JSONObject().put("title","old-private").put("attachmentId",hash).put("attachmentMime","text/plain")).toString())).put(row("line_items","line","same","{}"));
                db.beginTransaction();try{LedgerTables.create(db,7);LedgerTables.apply(db,new JSONArray(),rows,codec);db.setVersion(3);db.setTransactionSuccessful();}finally{db.endTransaction();}
                db.beginTransaction();try{MultiLedgerTables.migrate(db,7,profile("legacy-default","دفتر اولیه"),codec);/* simulate interruption */}finally{db.endTransaction();}
                assertEquals(3,db.getVersion());LedgerTables.verifyMigration(db,rows,codec);
                db.beginTransaction();try{MultiLedgerTables.migrate(db,7,profile("legacy-default","دفتر اولیه"),codec);db.setTransactionSuccessful();}finally{db.endTransaction();}
                assertEquals(4,db.getVersion());assertEquals(8,LedgerTables.revision(db,"ledger_revision"));
                JSONArray root=MultiLedgerTables.read(db,codec);assertEquals(1,root.length());assertEquals(3,root.getJSONObject(0).getJSONArray("rows").length());
                assertTrue(MultiLedgerTables.attachments(root).contains(hash));
                JSONArray jam=new JSONArray().put(row("meta","state",null,"{}")).put(row("expenses","same",null,"{\"header\":{\"title\":\"jam-private\"}}")).put(row("line_items","line","same","{}"));
                root.put(new JSONObject().put("profile",profile("jam","دفتر جم")).put("rows",jam));
                db.beginTransaction();try{assertTrue(MultiLedgerTables.commit(db,8,root,codec));db.setTransactionSuccessful();}finally{db.endTransaction();}
                assertEquals(9,LedgerTables.revision(db,"ledger_revision"));
                assertTrue(MultiLedgerTables.readRows(db,"legacy-default",codec).toString().contains("old-private"));
                assertTrue(MultiLedgerTables.readRows(db,"jam",codec).toString().contains("jam-private"));
                assertFalse(MultiLedgerTables.readRows(db,"jam",codec).toString().contains("old-private"));
                db.beginTransaction();try{assertFalse(MultiLedgerTables.commit(db,8,root,codec));}finally{db.endTransaction();}
                // FK parent exists in legacy-default, but not jam.
                JSONArray bad=new JSONArray().put(row("meta","state",null,"{}")).put(row("line_items","foreign","same","{}"));
                root.getJSONObject(1).put("rows",bad);
                db.beginTransaction();try{try{MultiLedgerTables.commit(db,9,root,codec);fail("Cross-scope foreign key must fail");}catch(android.database.sqlite.SQLiteException expected){}}finally{db.endTransaction();}
                assertEquals(9,LedgerTables.revision(db,"ledger_revision"));assertEquals(3,MultiLedgerTables.readRows(db,"jam",codec).length());
                try(SQLiteStatement s=db.compileStatement("SELECT payload FROM multi_expenses WHERE ledger_id='legacy-default' AND row_id='same'")){assertFalse(s.simpleQueryForString().contains("old-private"));}
                // Encrypted identity binds the row to its workspace; copying ciphertext is rejected.
                db.beginTransaction();try{
                    db.execSQL("UPDATE multi_expenses SET payload=(SELECT payload FROM multi_expenses WHERE ledger_id='legacy-default' AND row_id='same') WHERE ledger_id='jam' AND row_id='same'");
                    try{MultiLedgerTables.readRows(db,"jam",codec);fail("Ciphertext transplant must fail");}catch(IllegalStateException expected){}
                }finally{db.endTransaction();}
                assertTrue(MultiLedgerTables.attachments(MultiLedgerTables.read(db,codec)).contains(hash));
            }
            try(SQLiteDatabase db=ctx.openOrCreateDatabase(name,Context.MODE_PRIVATE,null)){
                assertEquals(4,db.getVersion());assertEquals(2,MultiLedgerTables.read(db,codec).length());
                assertEquals(9,LedgerTables.revision(db,"ledger_revision"));
            }
        }finally{ctx.deleteDatabase(name);if(ks.containsAlias(alias))ks.deleteEntry(alias);}
    }
}
