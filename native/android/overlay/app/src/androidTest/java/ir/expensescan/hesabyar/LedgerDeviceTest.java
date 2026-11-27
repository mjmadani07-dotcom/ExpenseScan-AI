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
    @Test public void nativePdfHasMultiplePagesAndCanRender()throws Exception{
        Context ctx=ApplicationProvider.getApplicationContext();
        JSONArray rows=new JSONArray();for(int i=0;i<60;i++)rows.put(new JSONArray().put("۱۴۰۵/۰۸/۲۷").put("خرید تجهیزات\nفروشنده نمونه").put("عملیات").put("۱۲٬۳۴۵ تومان").put("۲٬۰۰۰ تومان").put("۱۰٬۳۴۵ تومان").put("ناقص"));
        JSONObject report=new JSONObject().put("title","گزارش دفتر هزینه‌ها").put("scope","آزمون فارسی").put("date","۱۴۰۵/۰۸/۲۷").put("unit","تومان").put("count","۶۰").put("total","۷۴۰٬۷۰۰ تومان").put("paid","۱۲۰٬۰۰۰ تومان").put("remaining","۶۲۰٬۷۰۰ تومان").put("rows",rows);
        byte[] data=ExpenseReportPdf.render(report);
        assertEquals("%PDF-",new String(data,0,5,StandardCharsets.US_ASCII));
        java.io.File file=java.io.File.createTempFile("report-test",".pdf",ctx.getCacheDir());
        try{
            try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){out.write(data);}
            try(android.os.ParcelFileDescriptor fd=android.os.ParcelFileDescriptor.open(file,android.os.ParcelFileDescriptor.MODE_READ_ONLY);
                android.graphics.pdf.PdfRenderer renderer=new android.graphics.pdf.PdfRenderer(fd)){
                assertTrue(renderer.getPageCount()>1);
                try(android.graphics.pdf.PdfRenderer.Page page=renderer.openPage(0)){
                    android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(842,595,android.graphics.Bitmap.Config.ARGB_8888);
                    page.render(bitmap,null,null,android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    boolean hasTeal=false;for(int y=25;y<300&&!hasTeal;y++)if(bitmap.getPixel(25,y)==android.graphics.Color.rgb(15,118,110))hasTeal=true;assertTrue("Report table header rendered",hasTeal);
                    bitmap.recycle();
                }
            }
        }finally{file.delete();}
    }
    @Test public void installedAppStartsAtSecureLockScreen()throws Exception{
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->assertTrue((activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0));
            scenario.onActivity(activity->{android.view.View root=activity.findViewById(android.R.id.content);androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(root);assertNotNull(insets);androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout());assertTrue(root.getPaddingTop()>=bars.top);assertTrue(root.getPaddingBottom()>=bars.bottom);});
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
