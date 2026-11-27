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
    private void unlock(ActivityScenario<MainActivity> app)throws Exception{
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
            waitFor(app,"document.querySelector('nav[aria-label=\"ناوبری موبایل\"]')","App did not unlock with system credential");
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
            nav(app,"تنظیمات");
            String passwordSelector="section input[autocomplete=new-password]";
            field(app,passwordSelector,PASSWORD);
            // Each password is in a different label; target the second via the input collection.
            eval(app,"(()=>{const e=document.querySelectorAll("+JSONObject.quote(passwordSelector)+")[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(PASSWORD)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            String save=buttons("ذخیره فایل پشتیبان");waitFor(app,save,"Backup export control unavailable");
            eval(app,"(()=>{const b="+save+";setTimeout(()=>b.click(),100);return true})()");saveDocument();
            text(app,"فایل پشتیبان رمزگذاری‌شده ذخیره شد.");
            String path=shell("find /sdcard/Download -maxdepth 1 -type f -name 'ExpenseScan-*.esbackup2' | head -n 1");
            assertTrue("SAF backup not found in Downloads",path.startsWith("/sdcard/Download/ExpenseScan-")&&path.endsWith(".esbackup2")&&!path.contains("'"));
            encoded=shell("base64 '"+path+"'").replaceAll("\\s","");
            byte[] archive=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
            assertTrue(archive.length>52);assertEquals("ESBACK2\n",new String(archive,0,8,StandardCharsets.UTF_8));
            assertFalse(new String(archive,StandardCharsets.ISO_8859_1).contains(EDITED));
            nav(app,"هزینه‌ها");openRecord(app,EDITED);click(app,"حذف سند");click(app,"حذف قطعی شود");
            waitFor(app,"!document.querySelector('#expense-detail-title')","Delete did not close detail");record(app,null,0);
            nav(app,"تنظیمات");
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
        try(ActivityScenario<MainActivity> reopened=ActivityScenario.launch(MainActivity.class)){
            unlock(reopened);nav(reopened,"هزینه‌ها");text(reopened,EDITED);
            JSONObject persisted=record(reopened,EDITED,23456);assertEquals(id,persisted.getString("id"));assertEquals(attachment,persisted.getString("attachmentId"));
            openRecord(reopened,EDITED);click(reopened,"مشاهده فایل اصلی در حساب‌یار");text(reopened,"E2E original receipt");
        }
    }
}
