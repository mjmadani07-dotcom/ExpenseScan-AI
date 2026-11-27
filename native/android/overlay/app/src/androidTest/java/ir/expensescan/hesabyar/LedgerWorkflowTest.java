package ir.expensescan.hesabyar;

import android.os.ParcelFileDescriptor;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.regex.Pattern;
import android.util.Log;
import android.view.KeyEvent;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LedgerWorkflowTest {
    private final UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private static final String TITLE="E2E invoice", EDITED="E2E revised invoice", PASSWORD="synthetic backup passphrase";
    private static final String PIN="2468"; // disposable emulator only
    private String shell(String command)throws Exception{
        try(ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
            InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(fd)){
            return new String(input.readAllBytes(),StandardCharsets.UTF_8).trim();
        }
    }
    private String eval(ActivityScenario<MainActivity> app,String js)throws Exception{
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        app.onActivity(a->a.getBridge().getWebView().evaluateJavascript(js,v->{value.set(v);latch.countDown();}));
        assertTrue("WebView evaluation timed out",latch.await(12,TimeUnit.SECONDS));
        return value.get();
    }
    private void waitFor(ActivityScenario<MainActivity> app,String expression,String message)throws Exception{
        long end=android.os.SystemClock.elapsedRealtime()+30000;
        do{
            if("true".equals(eval(app,"Boolean("+expression+")")))return;
            Thread.sleep(250);
        }while(android.os.SystemClock.elapsedRealtime()<end);
        fail(message);
    }
    private static String buttons(String label){
        return "Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()==="+JSONObject.quote(label)+")";
    }
    private void click(ActivityScenario<MainActivity> app,String label)throws Exception{
        String b=buttons(label);waitFor(app,b,"Button absent: "+label);
        assertEquals("true",eval(app,"(()=>{const b="+b+";if(!b)return false;b.click();return true})()"));
    }
    private void nav(ActivityScenario<MainActivity> app,String label)throws Exception{click(app,label);}
    private void text(ActivityScenario<MainActivity> app,String value)throws Exception{
        waitFor(app,"document.body.innerText.includes("+JSONObject.quote(value)+")","Expected visible text: "+value);
    }
    private void field(ActivityScenario<MainActivity> app,String selector,String value)throws Exception{
        String q=JSONObject.quote(selector);waitFor(app,"document.querySelector("+q+")","Missing field: "+selector);
        assertEquals("true",eval(app,"(()=>{const e=document.querySelector("+q+");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"));
    }
    private void file(ActivityScenario<MainActivity> app,String selector,String name,String mime,String base64)throws Exception{
        String q=JSONObject.quote(selector);waitFor(app,"document.querySelector("+q+")","Missing file input");
        assertEquals("true",eval(app,"(()=>{const e=document.querySelector("+q+"),d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob("+JSONObject.quote(base64)+"),c=>c.charCodeAt(0))],"+JSONObject.quote(name)+",{type:"+JSONObject.quote(mime)+"}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"));
    }
    private String resumed()throws Exception{
        String state=shell("dumpsys activity activities");
        for(String line:state.split("\n"))if(line.contains("topResumedActivity=")||line.contains("mResumedActivity:"))return line.trim();
        return "";
    }
    private void diagnostics(String stage){
        try{
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            device.dumpWindowHierarchy(out);
            String xml=out.toString("UTF-8");
            Log.e("ExpenseScanE2E",stage+"; foreground="+device.getCurrentPackageName()+"; "+resumed());
            Log.e("ExpenseScanE2E",xml.substring(0,Math.min(xml.length(),12000)));
        }catch(Exception ex){Log.e("ExpenseScanE2E","Unable to collect test diagnostics",ex);}
    }
    private static boolean credentialActivity(String activity){
        return (activity.contains("com.android.settings/")||activity.contains("com.google.android.settings/")||activity.contains("com.android.systemui/"))
            &&(activity.contains("ConfirmLock")||activity.contains("ConfirmDeviceCredential")||activity.contains("Credential")||activity.contains("Biometric"));
    }
    private android.app.KeyguardManager keyguard(){
        android.content.Context ctx=InstrumentationRegistry.getInstrumentation().getTargetContext();
        return (android.app.KeyguardManager)ctx.getSystemService(android.content.Context.KEYGUARD_SERVICE);
    }
    private void unlockDeviceScreen()throws Exception{
        // Only the disposable emulator has the known synthetic credential.
        assertTrue("Synthetic workflow must never run on a physical phone","1".equals(shell("getprop ro.kernel.qemu"))||"1".equals(shell("getprop ro.boot.qemu")));
        device.wakeUp();
        if(!keyguard().isKeyguardLocked())return;
        try{
            device.pressKeyCode(KeyEvent.KEYCODE_MENU);
            Thread.sleep(400);
            if(keyguard().isKeyguardLocked()){
                UiObject2 digit=device.findObject(By.res(Pattern.compile("com\\.android\\.systemui:id/(key2|digit_2)")));
                if(digit==null){
                    int x=device.getDisplayWidth()/2,h=device.getDisplayHeight();
                    device.swipe(x,h*4/5,x,h/5,20);
                }
                digit=device.wait(Until.findObject(By.res(Pattern.compile("com\\.android\\.systemui:id/(key2|digit_2)"))),6000);
                if(keyguard().isKeyguardLocked()){
                    assertNotNull("Device lockscreen PIN keypad not visible",digit);
                    for(char d:PIN.toCharArray()){
                        if(!keyguard().isKeyguardLocked())break;
                        UiObject2 key=device.findObject(By.res(Pattern.compile("com\\.android\\.systemui:id/(key"+d+"|digit_"+d+")")));
                        assertNotNull("Device PIN digit missing",key);key.click();
                        Thread.sleep(100);
                    }
                    if(keyguard().isKeyguardLocked()){
                        UiObject2 enter=device.findObject(By.res(Pattern.compile("com\\.android\\.systemui:id/(key_enter|keyEnter)")));
                        if(enter!=null&&enter.isEnabled())enter.click();else device.pressEnter();
                    }
                }
            }
            long until=android.os.SystemClock.elapsedRealtime()+15000;
            while(keyguard().isKeyguardLocked()&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(250);
            assertFalse("Device remained locked before app launch",keyguard().isKeyguardLocked());
            assertTrue("Device must retain its secure credential",keyguard().isDeviceSecure());
        }catch(AssertionError|Exception ex){diagnostics("Device lockscreen unlock failed");throw ex;}
    }
    private void unlock(ActivityScenario<MainActivity> app)throws Exception{unlock(app,false);}
    private void unlock(ActivityScenario<MainActivity> app,boolean multi)throws Exception{
        unlockDeviceScreen();
        text(app,"حساب‌یار قفل است");
        JSONObject status=bridge(app,"Capacitor.Plugins.LedgerStorage.sessionStatus()");
        assertTrue("Emulator must have a secure device credential",status.getBoolean("ok")&&status.getJSONObject("value").getBoolean("deviceSecure"));
        String b=buttons("ورود با رمز گوشی");waitFor(app,b,"Credential button unavailable");
        // Return from WebView before system credential UI takes the foreground.
        eval(app,"(()=>{const b="+b+";setTimeout(()=>b.click(),100);return true})()");
        boolean shown=false;
        try{
            long end=android.os.SystemClock.elapsedRealtime()+25000;
            do{
                String activity=resumed();
                if(credentialActivity(activity)){shown=true;break;}
                Thread.sleep(300);
            }while(android.os.SystemClock.elapsedRealtime()<end);
            if(!shown){diagnostics("Credential activity not displayed");fail("System credential activity not displayed");}
            UiObject2 entry=device.findObject(By.res(Pattern.compile(".*:id/(password_entry|pinEntry|pin_entry|passwordEntry)")));
            if(entry==null)entry=device.findObject(By.clazz("android.widget.EditText"));
            if(entry!=null)entry.click();
            // Android PIN views can be custom TextViews/keypads rather than EditText.
            // Dispatch digit keys only after verifying the actual OS credential activity.
            for(char digit:PIN.toCharArray()){
                if(!credentialActivity(resumed()))break;
                UiObject2 key=device.findObject(By.res(Pattern.compile(".*:id/(key"+digit+"|digit_"+digit+")")));
                if(key!=null)key.click();else device.pressKeyCode(KeyEvent.KEYCODE_0+(digit-'0'));
                Thread.sleep(150);
            }
            if(credentialActivity(resumed())){
                UiObject2 enter=device.findObject(By.res(Pattern.compile(".*:id/(key_enter|keyEnter|next_button|confirm_button)")));
                if(enter!=null&&enter.isEnabled())enter.click();else device.pressEnter();
            }
            end=android.os.SystemClock.elapsedRealtime()+25000;
            while(credentialActivity(resumed())&&android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(300);
            if(credentialActivity(resumed())){diagnostics("Credential verification did not return");fail("System credential did not verify");}
            waitFor(app,multi?"document.querySelector('h1')?.textContent.trim()==='دفاتر مالی'":"document.querySelector('nav[aria-label=\"ناوبری موبایل\"]')","App did not unlock with system credential");
            waitFor(app,"!document.body.innerText.includes('در حال بارگذاری')","Ledger loading failed");
        }catch(AssertionError|Exception ex){diagnostics("Unlock failed");throw ex;}
    }
    private JSONObject bridge(ActivityScenario<MainActivity> app,String operation)throws Exception{
        // Use the actual production Capacitor bridge, not an alternate database or mocked auth.
        eval(app,"(()=>{window.__workflowResult=null;("+operation+").then(x=>window.__workflowResult={ok:true,value:x}).catch(()=>window.__workflowResult={ok:false});return true})()");
        waitFor(app,"window.__workflowResult!==null","Native bridge result timed out");
        return new JSONObject(eval(app,"window.__workflowResult"));
    }
    private JSONObject record(ActivityScenario<MainActivity> app,String expectedTitle,int amount)throws Exception{
        JSONObject result=bridge(app,"Capacitor.Plugins.LedgerStorage.read({scope:'active'})");
        assertTrue("Read failed",result.getBoolean("ok"));JSONObject payload=result.getJSONObject("value");
        org.json.JSONArray rows=new org.json.JSONArray(payload.getString("rows"));JSONObject found=null;int count=0;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if("expenses".equals(row.getString("table"))){count++;found=new JSONObject(row.getString("data")).getJSONObject("header");}}
        assertEquals(expectedTitle==null?0:1,count);
        if(expectedTitle!=null){assertNotNull(found);assertEquals(expectedTitle,found.getString("title"));assertEquals(amount,found.getInt("amount"));assertEquals("IRT",found.getString("currency"));}
        return found;
    }
    private void confirm()throws Exception{
        UiObject2 ok=device.wait(Until.findObject(By.res("android:id/button1")),10000);
        assertNotNull("Confirmation dialog not shown",ok);ok.click();
    }
    private void openRecord(ActivityScenario<MainActivity> app,String title)throws Exception{
        String find="Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&b.textContent.includes("+JSONObject.quote(title)+"))";
        waitFor(app,find,"Ledger card missing");eval(app,"("+find+").click()");
        waitFor(app,"document.querySelector('#expense-detail-title')","Expense detail not opened");
    }
    private void saveDocument()throws Exception{
        UiObject2 save=device.wait(Until.findObject(By.text("Save")),10000);
        if(save==null)save=device.wait(Until.findObject(By.text("SAVE")),3000);
        assertNotNull("System document save control missing",save);
        // Select Downloads explicitly when a different location was opened.
        UiObject2 drawer=device.findObject(By.desc("Show roots"));
        if(drawer!=null){
            drawer.click();UiObject2 downloads=device.wait(Until.findObject(By.text("Downloads")),5000);
            if(downloads!=null)downloads.click();else device.pressBack();
            save=device.wait(Until.findObject(By.text("Save")),5000);
            if(save==null)save=device.wait(Until.findObject(By.text("SAVE")),3000);
            assertNotNull("System Save button missing after choosing Downloads",save);
        }
        save.click();
    }
    @Test public void offlineInvoiceLifecycleAndPortableBackup()throws Exception{
        // This runs only on a freshly provisioned disposable emulator.
        assertTrue("Synthetic workflow must never run on a physical phone","1".equals(shell("getprop ro.kernel.qemu"))||"1".equals(shell("getprop ro.boot.qemu")));
        assertEquals("1",shell("settings get global airplane_mode_on"));
        String id,attachment,encoded;
        unlockDeviceScreen();
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            unlock(app);
            nav(app,"هزینه‌ها");
            // Fix display unit explicitly to make the persisted monetary assertion deterministic.
            click(app,"تومان");record(app,null,0);
            nav(app,"ثبت سند");
            String original=android.util.Base64.encodeToString("E2E original receipt".getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP);
            file(app,"input[type=file][accept*='.txt']","e2e-receipt.txt","text/plain",original);
            click(app,"ثبت دستی با فایل اصلی");
            text(app,"بررسی و تایید نهایی پیش‌نویس");
            field(app,"input[id^='title-']",TITLE);field(app,"input[id^='vendor-']","E2E vendor");field(app,"input[id^='amount-']","12345");
            waitFor(app,"document.querySelector('form button[type=submit]:not(:disabled)')","Approval unavailable");
            eval(app,"document.querySelector('form button[type=submit]').click()");
            waitFor(app,"!document.querySelector('input[id^=\"title-\"]')","Approval did not complete");
            text(app,TITLE);
            JSONObject created=record(app,TITLE,12345);id=created.getString("id");attachment=created.getString("attachmentId");
            assertEquals("text/plain",created.getString("attachmentMime"));
            openRecord(app,TITLE);click(app,"مشاهده فایل اصلی در حساب‌یار");text(app,"E2E original receipt");
            click(app,"بستن نمایش فایل اصلی");click(app,"ویرایش کامل فاکتور");
            field(app,"input[id^='edit-title-']",EDITED);field(app,"input[id^='edit-amount-']","23456");
            click(app,"ذخیره تغییرات فاکتور");
            waitFor(app,"document.querySelector('#expense-detail-title')?.innerText==="+JSONObject.quote(EDITED),"Update did not complete");
            assertEquals(id,record(app,EDITED,23456).getString("id"));
            eval(app,"document.querySelector('button[aria-label=\"بستن جزئیات سند\"]').click()");
            String pdf=buttons("خروجی گزارش PDF");waitFor(app,pdf,"PDF control unavailable");
            eval(app,"(()=>{const b="+pdf+";setTimeout(()=>b.click(),100);return true})()");confirm();
            text(app,"فایل PDF در Downloads/HesabYar ذخیره شد.");
            String pdfPath=shell("find /sdcard/Download/HesabYar -maxdepth 1 -type f -name 'hesabyar-report-*.pdf' | head -n 1");
            assertTrue("PDF missing",pdfPath.startsWith("/sdcard/Download/HesabYar/hesabyar-report-")&&pdfPath.endsWith(".pdf")&&!pdfPath.contains("'"));
            byte[] pdfBytes=android.util.Base64.decode(shell("base64 '"+pdfPath+"'"),android.util.Base64.DEFAULT);
            assertTrue("PDF was empty",pdfBytes.length>64);assertEquals("%PDF-",new String(pdfBytes,0,5,StandardCharsets.US_ASCII));
            java.io.File copy=java.io.File.createTempFile("report-", ".pdf", androidx.test.core.app.ApplicationProvider.getApplicationContext().getCacheDir());
            try{
                try(java.io.FileOutputStream out=new java.io.FileOutputStream(copy)){out.write(pdfBytes);}
                try(android.graphics.pdf.PdfRenderer renderer=new android.graphics.pdf.PdfRenderer(ParcelFileDescriptor.open(copy,ParcelFileDescriptor.MODE_READ_ONLY))){assertTrue(renderer.getPageCount()>0);}
            }finally{copy.delete();}
            assertEquals(id,record(app,EDITED,23456).getString("id"));
            nav(app,"تنظیمات");
            String security="document.querySelector(\'button[aria-controls=settings-security]\')";waitFor(app,security,"Security settings missing");eval(app,"("+security+").click()");
            String passwordSelector="section input[autocomplete=new-password]";
            field(app,passwordSelector,PASSWORD);
            // Each password is in a different label; target the second via the input collection.
            eval(app,"(()=>{const e=document.querySelectorAll("+JSONObject.quote(passwordSelector)+")[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(PASSWORD)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            String save=buttons("ذخیره فایل پشتیبان");waitFor(app,save,"Backup export control unavailable");
            eval(app,"(()=>{const b="+save+";setTimeout(()=>b.click(),100);return true})()");
            text(app,"فایل پشتیبان رمزگذاری‌شده ذخیره شد.");
            String path=shell("find /sdcard/Download/HesabYar -maxdepth 1 -type f -name 'ExpenseScan-*.esbackup2' | head -n 1");
            assertTrue("Verified backup not found in Downloads",path.startsWith("/sdcard/Download/HesabYar/ExpenseScan-")&&path.endsWith(".esbackup2")&&!path.contains("'"));
            encoded=shell("base64 '"+path+"'").replaceAll("\\s","");
            byte[] archive=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
            assertTrue(archive.length>52);assertEquals("ESBACK2\n",new String(archive,0,8,StandardCharsets.UTF_8));
            assertFalse(new String(archive,StandardCharsets.ISO_8859_1).contains(EDITED));
            nav(app,"هزینه‌ها");openRecord(app,EDITED);click(app,"حذف سند");click(app,"حذف قطعی شود");
            waitFor(app,"!document.querySelector('#expense-detail-title')","Delete did not close detail");record(app,null,0);
            nav(app,"تنظیمات");
            waitFor(app,security,"Security settings missing");eval(app,"("+security+").click()");
            // Wrong password must reject the actual exported archive without restoring data.
            field(app,passwordSelector,"wrong password");
            file(app,"input[type=file][accept*='.esbackup']","backup.esbackup2","application/octet-stream",encoded);
            text(app,"گذرواژه نادرست است");record(app,null,0);
            field(app,passwordSelector,PASSWORD);
            file(app,"input[type=file][accept*='.esbackup']","backup.esbackup2","application/octet-stream",encoded);
            text(app,"فهرست رمزگذاری‌شده معتبر");
            // Return from evaluateJavascript before the synchronous JS confirmation blocks the WebView.
            String restore=buttons("تأیید بازیابی");waitFor(app,restore,"Restore control unavailable");
            eval(app,"(()=>{const b="+restore+";setTimeout(()=>b.click(),100);return true})()");confirm();
            text(app,"بازیابی انجام شد.");JSONObject restored=record(app,EDITED,23456);
            assertEquals(id,restored.getString("id"));assertEquals(attachment,restored.getString("attachmentId"));
            click(app,"قفل فوری برنامه");text(app,"حساب‌یار قفل است");
            assertFalse(bridge(app,"Capacitor.Plugins.LedgerStorage.read({scope:'active'})").getBoolean("ok"));
        }
        unlockDeviceScreen();
        try(ActivityScenario<MainActivity> reopened=ActivityScenario.launch(MainActivity.class)){
            unlock(reopened);nav(reopened,"هزینه‌ها");text(reopened,EDITED);
            JSONObject persisted=record(reopened,EDITED,23456);assertEquals(id,persisted.getString("id"));assertEquals(attachment,persisted.getString("attachmentId"));
            openRecord(reopened,EDITED);click(reopened,"مشاهده فایل اصلی در حساب‌یار");text(reopened,"E2E original receipt");
            // Synthetic baseline fingerprint stored in the test APK's separate
            // preferences, not in the application ledger or release APK.
            assertTrue(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext()
                .getSharedPreferences("upgrade_fixture",android.content.Context.MODE_PRIVATE).edit()
                .putString("id",id).putString("attachment",attachment).commit());
        }
    }
    @Test public void verifyPreservedLedgerAfterUpgrade()throws Exception{
        org.junit.Assume.assumeTrue("Run only after adb install -r",
            "true".equals(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("verifyUpgrade")));
        assertTrue("Synthetic workflow must never run on a physical phone","1".equals(shell("getprop ro.kernel.qemu"))||"1".equals(shell("getprop ro.boot.qemu")));
        android.content.SharedPreferences fixture=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getSharedPreferences("upgrade_fixture",android.content.Context.MODE_PRIVATE);
        String id=fixture.getString("id",null),attachment=fixture.getString("attachment",null);
        assertNotNull("Missing pre-upgrade fixture",id);assertNotNull(attachment);
        unlockDeviceScreen();
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            unlock(app);nav(app,"هزینه‌ها");text(app,EDITED);
            JSONObject persisted=record(app,EDITED,23456);
            assertEquals(id,persisted.getString("id"));assertEquals(attachment,persisted.getString("attachmentId"));
            openRecord(app,EDITED);click(app,"مشاهده فایل اصلی در حساب‌یار");text(app,"E2E original receipt");
        }
    }

    private void openCatalogLedger(ActivityScenario<MainActivity> app,String name)throws Exception{
        String target="Array.from(document.querySelectorAll('article')).find(a=>a.querySelector('h2')?.textContent.trim()==="+JSONObject.quote(name)+")?.querySelector('button')";
        waitFor(app,target,"Catalog entry missing: "+name);
        eval(app,"("+target+").click()");
        waitFor(app,"document.querySelector('nav[aria-label=\"ناوبری موبایل\"]')","Ledger did not open");
        text(app,"دفتر فعال");
        waitFor(app,"Array.from(document.querySelectorAll('header')).some(h=>h.getClientRects().length&&h.innerText.includes("+JSONObject.quote(name)+"))","Active ledger header is incorrect");
    }
    private void createCatalogLedger(ActivityScenario<MainActivity> app,String name)throws Exception{
        click(app,"دفتر جدید");field(app,"input[placeholder='مثلاً دفتر کرج']",name);click(app,"ذخیره دفتر");
        waitFor(app,"Array.from(document.querySelectorAll('article h2')).some(h=>h.textContent.trim()==="+JSONObject.quote(name)+")","New ledger not saved");
    }
    private void returnToCatalog(ActivityScenario<MainActivity> app)throws Exception{
        nav(app,"داشبورد");click(app,"تغییر دفتر");text(app,"دفاتر مالی");
    }
    private byte[] readReportFile(String extension)throws Exception{
        if(!"pdf".equals(extension)&&!"xlsx".equals(extension))throw new IllegalArgumentException("extension");
        String path=shell("find /sdcard/Download/HesabYar -maxdepth 1 -type f -name 'hesabyar-consolidated-*."+extension+"' | head -n 1");
        assertTrue("Report file missing",path.startsWith("/sdcard/Download/HesabYar/hesabyar-consolidated-")&&path.endsWith("."+extension)&&!path.contains("'"));
        return android.util.Base64.decode(shell("base64 '"+path+"'"),android.util.Base64.DEFAULT);
    }
    @Test public void multiLedgerCatalogAndScopedCapture()throws Exception{
        unlockDeviceScreen();
        assertEquals("1",shell("settings get global airplane_mode_on"));
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            unlock(app,true);
            createCatalogLedger(app,"دفتر کرج");
            createCatalogLedger(app,"دفتر جم");
            openCatalogLedger(app,"دفتر کرج");
            click(app,"تومان");nav(app,"ثبت سند");text(app,"ثبت سند در دفتر:");
            click(app,"ثبت دستی (آفلاین)");text(app,"بررسی و تایید نهایی پیش‌نویس");
            field(app,"input[id^='title-']","Karaj E2E");field(app,"input[id^='vendor-']","Synthetic vendor");field(app,"input[id^='amount-']","34567");
            waitFor(app,"document.querySelector('form button[type=submit]:not(:disabled)')","Approval unavailable");
            eval(app,"document.querySelector('form button[type=submit]').click()");
            waitFor(app,"!document.querySelector('input[id^=\"title-\"]')","Approval did not complete");
            text(app,"Karaj E2E");
            returnToCatalog(app);
            openCatalogLedger(app,"دفتر جم");nav(app,"هزینه‌ها");
            waitFor(app,"!document.body.innerText.includes('Karaj E2E')","Karaj expense leaked into Jam");
            JSONObject result=bridge(app,"Capacitor.Plugins.LedgerStorage.readMulti()");
            assertTrue(result.getBoolean("ok"));
            JSONArray workspaces=new JSONArray(result.getJSONObject("value").getString("workspaces"));
            int karaj=0,jam=0;boolean foundKaraj=false,foundJam=false;
            for(int i=0;i<workspaces.length();i++){
                JSONObject w=workspaces.getJSONObject(i);String name=w.getJSONObject("profile").getString("name");
                JSONArray rows=w.getJSONArray("rows");
                if("دفتر کرج".equals(name))foundKaraj=true;if("دفتر جم".equals(name))foundJam=true;
                for(int j=0;j<rows.length();j++){
                    JSONObject row=rows.getJSONObject(j);if(!"expenses".equals(row.getString("table")))continue;
                    if("دفتر کرج".equals(name)){
                        karaj++;JSONObject record=new JSONObject(row.getString("data")).getJSONObject("header");
                        assertEquals("Karaj E2E",record.getString("title"));assertEquals(34567,record.getInt("amount"));assertEquals("IRT",record.getString("currency"));
                    }else if("دفتر جم".equals(name))jam++;
                }
            }
            assertTrue(foundKaraj&&foundJam);assertEquals(1,karaj);assertEquals(0,jam);
            // Add a second actual record to the other workspace.
            nav(app,"ثبت سند");click(app,"ثبت دستی (آفلاین)");text(app,"بررسی و تایید نهایی پیش‌نویس");
            field(app,"input[id^='title-']","Jam E2E");field(app,"input[id^='vendor-']","Synthetic vendor");field(app,"input[id^='amount-']","23456");
            waitFor(app,"document.querySelector('form button[type=submit]:not(:disabled)')","Jam approval unavailable");
            eval(app,"document.querySelector('form button[type=submit]').click()");
            waitFor(app,"!document.querySelector('input[id^=\"title-\"]')","Jam approval did not complete");text(app,"Jam E2E");
            returnToCatalog(app);click(app,"گزارش تلفیقی دفاتر");text(app,"دفاتر گزارش");
            String karajChoice="document.querySelector('input[type=checkbox][aria-label=\"دفتر کرج\"]')";
            String jamChoice="document.querySelector('input[type=checkbox][aria-label=\"دفتر جم\"]')";
            waitFor(app,karajChoice,"Karaj report selector missing");waitFor(app,jamChoice,"Jam report selector missing");
            assertEquals("0",eval(app,"document.querySelectorAll('input[type=checkbox]:checked').length"));
            eval(app,"("+karajChoice+").click()");click(app,"تولید گزارش");text(app,"Karaj E2E");
            waitFor(app,"!document.querySelector('[aria-label=\"نتیجه گزارش\"]').innerText.includes('Jam E2E')","Unselected ledger leaked into report");
            eval(app,"("+jamChoice+").click()");
            waitFor(app,"!document.querySelector('[aria-label=\"نتیجه گزارش\"]')","Old report was not invalidated");
            click(app,"تولید گزارش");text(app,"Jam E2E");text(app,"Karaj E2E");text(app,"۵۸,۰۲۳ تومان");
            String pdfButton=buttons("خروجی PDF");waitFor(app,pdfButton,"Consolidated PDF unavailable");
            eval(app,"(()=>{const b="+pdfButton+";setTimeout(()=>b.click(),100);return true})()");confirm();
            text(app,"فایل PDF در Downloads/HesabYar ذخیره شد.");
            byte[] pdfBytes=readReportFile("pdf");assertTrue(pdfBytes.length>64);assertEquals("%PDF-",new String(pdfBytes,0,5,StandardCharsets.US_ASCII));
            java.io.File pdf=java.io.File.createTempFile("consolidated-", ".pdf", androidx.test.core.app.ApplicationProvider.getApplicationContext().getCacheDir());
            try{
                try(java.io.FileOutputStream out=new java.io.FileOutputStream(pdf)){out.write(pdfBytes);}
                try(android.graphics.pdf.PdfRenderer renderer=new android.graphics.pdf.PdfRenderer(ParcelFileDescriptor.open(pdf,ParcelFileDescriptor.MODE_READ_ONLY))){
                    assertTrue(renderer.getPageCount()>0);
                }
            }finally{pdf.delete();}
            String excelButton=buttons("خروجی Excel");waitFor(app,excelButton,"Consolidated Excel unavailable");
            eval(app,"(()=>{const b="+excelButton+";setTimeout(()=>b.click(),100);return true})()");confirm();
            text(app,"فایل Excel ذخیره شد.");
            byte[] excel=readReportFile("xlsx");assertTrue(excel.length>128);
            java.util.Map<String,String> xml=new java.util.HashMap<>();
            try(java.util.zip.ZipInputStream zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(excel))){
                java.util.zip.ZipEntry entry;while((entry=zip.getNextEntry())!=null){
                    if(entry.getName().endsWith(".xml"))xml.put(entry.getName(),new String(zip.readAllBytes(),StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
            }
            assertNotNull(xml.get("xl/worksheets/sheet1.xml"));assertNotNull(xml.get("xl/worksheets/sheet2.xml"));
            assertTrue("Workbook total missing",xml.get("xl/worksheets/sheet1.xml").contains("<v>58023</v>"));
            String all=xml.values().toString();assertTrue(all.contains("Karaj E2E")&&all.contains("Jam E2E"));
            assertTrue(all.contains("دفتر کرج")&&all.contains("دفتر جم"));assertFalse(all.contains("دفتر اولیه"));
            click(app,"دفاتر مالی");openCatalogLedger(app,"دفتر کرج");nav(app,"هزینه‌ها");text(app,"Karaj E2E");
            waitFor(app,"!document.body.innerText.includes('Jam E2E')","Reporting changed the write scope");
            click(app,"قفل");text(app,"حساب‌یار قفل است");
        }
    }
}
