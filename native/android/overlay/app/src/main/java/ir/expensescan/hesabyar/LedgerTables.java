package ir.expensescan.hesabyar;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

final class LedgerTables {
    static final int VERSION=3;
    private static final String[] TABLES={"meta","categories","budgets","rates","expenses","line_items","payment_tranches","drafts","recoveries","approval"};
    private static final int MAX_ROW=32*1024*1024;
    interface Codec {
        String seal(String plain) throws Exception;
        String open(String cipher) throws Exception;
    }
    static String name(String t) {
        for(String allowed:TABLES)if(allowed.equals(t))return "ledger_"+t;
        throw new IllegalArgumentException("Unknown ledger table");
    }
    private static boolean child(String t){return "line_items".equals(t)||"payment_tranches".equals(t);}
    private static String id(JSONObject obj,String k)throws Exception {
        String id=obj.getString(k);
        if(id.isEmpty()||id.length()>4096||id.indexOf(0)>=0)throw new IllegalArgumentException("Invalid row identifier");
        return id;
    }
    static void create(SQLiteDatabase db,long revision){
        db.execSQL("CREATE TABLE ledger_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0))");
        ContentValues v=new ContentValues();v.put("id",1);v.put("revision",revision);db.insertOrThrow("ledger_revision",null,v);
        for(String t:TABLES){
            String n=name(t);
            db.execSQL("CREATE TABLE "+n+" (row_id TEXT PRIMARY KEY NOT NULL, parent_id TEXT "+(child(t)?"NOT NULL REFERENCES ledger_expenses(row_id) ON DELETE RESTRICT":"CHECK(parent_id IS NULL)")+", payload TEXT NOT NULL)");
            if(child(t))db.execSQL("CREATE INDEX "+n+"_parent ON "+n+"(parent_id)");
        }
    }
    static long revision(SQLiteDatabase db,String table){
        // Only called with the constant legacy or current revision table.
        if(!"ledger_revision".equals(table)&&!"ledger_state".equals(table))throw new IllegalArgumentException("Invalid revision table");
        try(SQLiteStatement stmt=db.compileStatement("SELECT revision FROM "+table+" WHERE id=1")){return stmt.simpleQueryForLong();}
    }
    private static String payload(SQLiteDatabase db,String t,String id){
        try(SQLiteStatement stmt=db.compileStatement("SELECT payload FROM "+name(t)+" WHERE row_id=?")){
            stmt.bindString(1,id);return stmt.simpleQueryForString();
        }
    }
    static JSONArray read(SQLiteDatabase db,Codec codec)throws Exception {
        JSONArray rows=new JSONArray();
        for(String t:TABLES){
            // Do not put large encrypted values in a CursorWindow.
            try(Cursor c=db.rawQuery("SELECT row_id,parent_id FROM "+name(t)+" ORDER BY row_id",null)){
                while(c.moveToNext()){
                    String id=c.getString(0),parent=c.isNull(1)?null:c.getString(1);
                    JSONArray plain=new JSONArray(codec.open(payload(db,t,id)));
                    if(plain.length()!=4||!t.equals(plain.getString(0))||!id.equals(plain.getString(1))||(parent==null?!plain.isNull(2):!parent.equals(plain.getString(2))))throw new IllegalStateException("Encrypted row identity mismatch");
                    JSONObject row=new JSONObject();row.put("table",t);row.put("id",id);row.put("parent",parent==null?JSONObject.NULL:parent);row.put("data",plain.getString(3));rows.put(row);
                }
            }
        }
        return rows;
    }
    static void verifyMigration(SQLiteDatabase db,JSONArray expected,Codec codec)throws Exception{
        JSONArray actual=read(db,codec);
        if(actual.length()!=expected.length())throw new IllegalStateException("Migration row count mismatch");
        java.util.Map<String,JSONObject> map=new java.util.HashMap<>();
        for(int i=0;i<actual.length();i++){JSONObject row=actual.getJSONObject(i);map.put(row.getString("table")+":"+row.getString("id"),row);}
        for(int i=0;i<expected.length();i++){
            JSONObject row=expected.getJSONObject(i);
            JSONObject other=map.remove(row.getString("table")+":"+row.getString("id"));
            if(other==null||!row.getString("data").equals(other.getString("data"))||!row.opt("parent").equals(other.opt("parent")))throw new IllegalStateException("Migration content mismatch");
        }
        if(!map.isEmpty())throw new IllegalStateException("Unexpected migration row");
    }
    static void apply(SQLiteDatabase db,JSONArray deletes,JSONArray upserts,Codec codec)throws Exception{
        Set<String> seen=new HashSet<>();
        for(int i=0;i<deletes.length();i++){
            JSONObject row=deletes.getJSONObject(i);String t=row.getString("table"),id=id(row,"id");name(t);
            if(!seen.add(t+":"+id))throw new IllegalArgumentException("Duplicate row change");
        }
        for(int i=0;i<upserts.length();i++){
            JSONObject row=upserts.getJSONObject(i);String t=row.getString("table"),id=id(row,"id");name(t);
            if(!seen.add(t+":"+id))throw new IllegalArgumentException("Duplicate row change");
        }
        // Delete children first and write parents first to preserve FK integrity.
        for(int k=TABLES.length-1;k>=0;k--)for(int i=0;i<deletes.length();i++){
            JSONObject row=deletes.getJSONObject(i);String t=row.getString("table");
            if(!TABLES[k].equals(t))continue;
            if(db.delete(name(t),"row_id=?",new String[]{id(row,"id")})!=1)throw new IllegalStateException("Missing row for deletion");
        }
        for(String t:TABLES)for(int i=0;i<upserts.length();i++){
            JSONObject row=upserts.getJSONObject(i);if(!t.equals(row.getString("table")))continue;
            String id=id(row,"id"),parent=row.isNull("parent")?null:id(row,"parent"),data=row.getString("data");
            if(child(t)!=(parent!=null)||data.length()>MAX_ROW)throw new IllegalArgumentException("Invalid ledger row");
            JSONArray envelope=new JSONArray();envelope.put(t);envelope.put(id);envelope.put(parent==null?JSONObject.NULL:parent);envelope.put(data);
            ContentValues v=new ContentValues();v.put("payload",codec.seal(envelope.toString()));if(parent==null)v.putNull("parent_id");else v.put("parent_id",parent);
            int n=db.update(name(t),v,"row_id=?",new String[]{id});
            if(n==0){v.put("row_id",id);db.insertOrThrow(name(t),null,v);}
            else if(n!=1)throw new IllegalStateException("Unexpected row count");
        }
        try(SQLiteStatement stmt=db.compileStatement("SELECT count(*) FROM ledger_meta WHERE row_id='state'")){
            if(stmt.simpleQueryForLong()!=1)throw new IllegalStateException("Missing ledger manifest");
        }
    }
}
