package ir.expensescan.hesabyar;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;

final class DownloadPublisher {
    interface Source { InputStream open() throws Exception; }
    interface Session { boolean valid(); }
    // Android 10+: publish only after the entire file is written and verified.
    static Uri publish(ContentResolver resolver,String name,String mime,Source source,long expected,Session session)throws Exception{
        if(expected<=0||!session.valid())throw new IllegalStateException("Empty export or locked session");
        ContentValues values=new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
        values.put(MediaStore.MediaColumns.MIME_TYPE,mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/HesabYar/");
        values.put(MediaStore.MediaColumns.IS_PENDING,1);
        Uri uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
        if(uri==null)throw new IllegalStateException("Cannot create download");
        boolean published=false;
        try{
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            byte[] buffer=new byte[65536];long written=0;
            try(InputStream in=source.open();OutputStream out=resolver.openOutputStream(uri,"w")){
                if(out==null)throw new IllegalStateException("Cannot open download");
                int n;while((n=in.read(buffer))!=-1){
                    if(!session.valid())throw new IllegalStateException("Session expired");
                    out.write(buffer,0,n);digest.update(buffer,0,n);written+=n;
                    if(written>expected)throw new IllegalStateException("Source changed");
                }
                out.flush();
            }
            if(written!=expected)throw new IllegalStateException("Incomplete export");
            MessageDigest check=MessageDigest.getInstance("SHA-256");long read=0;
            try(InputStream in=resolver.openInputStream(uri)){
                if(in==null)throw new IllegalStateException("Cannot verify download");
                int n;while((n=in.read(buffer))!=-1){
                    if(!session.valid())throw new IllegalStateException("Session expired");
                    check.update(buffer,0,n);read+=n;
                    if(read>expected)throw new IllegalStateException("Unexpected destination size");
                }
            }
            if(read!=expected||!MessageDigest.isEqual(digest.digest(),check.digest())||!session.valid())throw new IllegalStateException("Export verification failed");
            ContentValues ready=new ContentValues();ready.put(MediaStore.MediaColumns.IS_PENDING,0);
            if(resolver.update(uri,ready,null,null)!=1)throw new IllegalStateException("Cannot publish download");
            published=true;return uri;
        }finally{if(!published){try{resolver.delete(uri,null,null);}catch(Exception ignored){}}}
    }
}
