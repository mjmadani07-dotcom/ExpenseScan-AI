package ir.expensescan.hesabyar;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

// Schema 4: encrypted catalog and independently addressable rows. All writes
// occur under the caller's SQLite transaction and global revision CAS.
final class MultiLedgerTables {
    static final int VERSION=4;
    static final String DEFAULT_ID="legacy-default";
    private static final String[] TABLES={"meta","categories","budgets","rates","expenses","line_items","payment_tranches","drafts","recoveries","approval"};
    private static final int MAX_ROW=32*1024*1024;
    private static String table(String t){
        for(String x:TABLES)if(x.equals(t))return "multi_"+t;
        throw new IllegalArgumentException("Unknown table");
    }
    private static boolean child(String t){return "line_items".equals(t)||"payment_tranches".equals(t);}
    private static String scope(String id){if(!id.matches("[a-zA-Z0-9_-]{1,80}"))throw new IllegalArgumentException("Invalid workspace");return id;}
    private static String rowId(String id){if(id.trim().isEmpty()||id.length()>4096||id.indexOf(0)>=0)throw new IllegalArgumentException("Invalid row");return id;}
    private static String scalar(SQLiteDatabase db,String sql,String...args){
        try(SQLiteStatement s=db.compileStatement(sql)){for(int i=0;i<args.length;i++)s.bindString(i+1,args[i]);return s.simpleQueryForString();}
    }
    private static void requireTransaction(SQLiteDatabase db){if(!db.inTransaction())throw new IllegalStateException("Transaction required");}
    private static void create(SQLiteDatabase db){
        db.execSQL("CREATE TABLE multi_profiles (ledger_id TEXT PRIMARY KEY NOT NULL, position INTEGER NOT NULL UNIQUE CHECK(position>=0), payload TEXT NOT NULL)");
        for(String t:TABLES){
            String n=table(t);
            db.execSQL("CREATE TABLE "+n+" (ledger_id TEXT NOT NULL REFERENCES multi_profiles(ledger_id) ON DELETE RESTRICT, row_id TEXT NOT NULL, parent_id TEXT "+(child(t)?"NOT NULL":"CHECK(parent_id IS NULL)")+", payload TEXT NOT NULL, PRIMARY KEY(ledger_id,row_id)"+(child(t)?", FOREIGN KEY(ledger_id,parent_id) REFERENCES multi_expenses(ledger_id,row_id) ON DELETE RESTRICT":"")+")");
            if(child(t))db.execSQL("CREATE INDEX "+n+"_parent ON "+n+"(ledger_id,parent_id)");
        }
    }
    private static JSONObject validateProfile(JSONObject p)throws Exception{
        scope(p.getString("id"));
        String name=p.getString("name"),color=p.getString("color"),date=p.getString("createdAt");
        if(name.trim().isEmpty()||name.length()>80||!color.matches("#[0-9a-fA-F]{6}")||date.length()>64||date.isEmpty()||!(p.get("archived") instanceof Boolean))throw new IllegalArgumentException("Invalid profile");
        return p;
    }
    private static void saveProfile(SQLiteDatabase db,JSONObject profile,int position,LedgerTables.Codec codec)throws Exception{
        validateProfile(profile);String id=profile.getString("id");
        JSONArray envelope=new JSONArray().put("profile").put(id).put(position).put(profile.toString());
        ContentValues v=new ContentValues();v.put("position",position);v.put("payload",codec.seal(envelope.toString()));
        if(db.update("multi_profiles",v,"ledger_id=?",new String[]{id})==0){v.put("ledger_id",id);db.insertOrThrow("multi_profiles",null,v);}
    }
    private static JSONObject profile(SQLiteDatabase db,String id,int position,LedgerTables.Codec codec)throws Exception{
        JSONArray e=new JSONArray(codec.open(scalar(db,"SELECT payload FROM multi_profiles WHERE ledger_id=?",id)));
        if(e.length()!=4||!"profile".equals(e.getString(0))||!id.equals(e.getString(1))||position!=e.getInt(2))throw new IllegalStateException("Profile identity mismatch");
        JSONObject p=validateProfile(new JSONObject(e.getString(3)));
        if(!id.equals(p.getString("id")))throw new IllegalStateException("Profile ID mismatch");
        return p;
    }
    static JSONArray readRows(SQLiteDatabase db,String id,LedgerTables.Codec codec)throws Exception{
        scope(id);JSONArray rows=new JSONArray();
        for(String t:TABLES){
            try(Cursor c=db.rawQuery("SELECT row_id,parent_id FROM "+table(t)+" WHERE ledger_id=? ORDER BY row_id",new String[]{id})){
                while(c.moveToNext()){
                    String rid=c.getString(0),parent=c.isNull(1)?null:c.getString(1);
                    JSONArray e=new JSONArray(codec.open(scalar(db,"SELECT payload FROM "+table(t)+" WHERE ledger_id=? AND row_id=?",id,rid)));
                    if(e.length()!=5||!id.equals(e.getString(0))||!t.equals(e.getString(1))||!rid.equals(e.getString(2))||(parent==null?!e.isNull(3):!parent.equals(e.getString(3))))throw new IllegalStateException("Encrypted scoped row identity mismatch");
                    rows.put(new JSONObject().put("table",t).put("id",rid).put("parent",parent==null?JSONObject.NULL:parent).put("data",e.getString(4)));
                }
            }
        }
        return rows;
    }
    static JSONArray read(SQLiteDatabase db,LedgerTables.Codec codec)throws Exception{
        if(db.getVersion()!=VERSION)throw new IllegalStateException("Unsupported multi-ledger schema");
        JSONArray result=new JSONArray();boolean active=false;
        try(Cursor c=db.rawQuery("SELECT ledger_id,position FROM multi_profiles ORDER BY position",null)){
            while(c.moveToNext()){
                String id=scope(c.getString(0));int position=c.getInt(1);
                if(position!=result.length()||position>=100)throw new IllegalStateException("Invalid catalog order");
                JSONObject p=profile(db,id,position,codec);active|=!p.getBoolean("archived");
                JSONArray rows=readRows(db,id,codec);validateRows(rows);
                result.put(new JSONObject().put("profile",p).put("rows",rows));
            }
        }
        if(!active)throw new IllegalStateException("No active ledger");
        return result;
    }
    private static String key(JSONObject r)throws Exception{return new JSONArray().put(r.getString("table")).put(r.getString("id")).toString();}
    private static Map<String,JSONObject> validateRows(JSONArray rows)throws Exception{
        Map<String,JSONObject> map=new HashMap<>();int manifests=0;
        for(int i=0;i<rows.length();i++){
            JSONObject r=rows.getJSONObject(i);String t=r.getString("table"),id=rowId(r.getString("id"));table(t);
            if(!r.has("parent")||child(t)==r.isNull("parent")||r.getString("data").length()>MAX_ROW||map.put(key(r),r)!=null)throw new IllegalArgumentException("Invalid scoped row");
            if(child(t))rowId(r.getString("parent"));
            if("meta".equals(t)){if(!"state".equals(id))throw new IllegalArgumentException("Invalid manifest ID");manifests++;}
        }
        if(manifests!=1)throw new IllegalArgumentException("Missing manifest");
        return map;
    }
    private static boolean same(JSONObject a,JSONObject b)throws Exception{return a.getString("data").equals(b.getString("data"))&&a.get("parent").equals(b.get("parent"));}
    private static void verify(JSONArray actual,JSONArray expected)throws Exception{
        Map<String,JSONObject> map=validateRows(actual),target=validateRows(expected);
        if(!map.keySet().equals(target.keySet()))throw new IllegalStateException("Row set changed");
        for(String key:target.keySet())if(!same(map.get(key),target.get(key)))throw new IllegalStateException("Row content changed");
    }
    private static void replaceRows(SQLiteDatabase db,String id,JSONArray before,JSONArray after,LedgerTables.Codec codec)throws Exception{
        Map<String,JSONObject> old=before.length()==0?new HashMap<>():validateRows(before),next=validateRows(after);
        for(int k=TABLES.length-1;k>=0;k--)for(Map.Entry<String,JSONObject> entry:old.entrySet()){
            JSONObject r=entry.getValue();String t=r.getString("table");
            if(TABLES[k].equals(t)&&!next.containsKey(entry.getKey())&&db.delete(table(t),"ledger_id=? AND row_id=?",new String[]{id,r.getString("id")})!=1)throw new IllegalStateException("Missing scoped delete");
        }
        for(String t:TABLES)for(Map.Entry<String,JSONObject> entry:next.entrySet()){
            JSONObject r=entry.getValue(),prior=old.get(entry.getKey());if(!t.equals(r.getString("table"))||(prior!=null&&same(prior,r)))continue;
            String rid=r.getString("id"),parent=r.isNull("parent")?null:r.getString("parent");
            JSONArray envelope=new JSONArray().put(id).put(t).put(rid).put(parent==null?JSONObject.NULL:parent).put(r.getString("data"));
            ContentValues v=new ContentValues();v.put("payload",codec.seal(envelope.toString()));if(parent==null)v.putNull("parent_id");else v.put("parent_id",parent);
            if(db.update(table(t),v,"ledger_id=? AND row_id=?",new String[]{id,rid})==0){v.put("ledger_id",id);v.put("row_id",rid);db.insertOrThrow(table(t),null,v);}
        }
        verify(readRows(db,id,codec),after);
    }
    static Set<String> attachments(JSONArray workspaces)throws Exception{
        Set<String> result=new HashSet<>();
        for(int i=0;i<workspaces.length();i++)result.addAll(AttachmentReferences.fromRows(workspaces.getJSONObject(i).getJSONArray("rows")));
        return result;
    }
    static void migrate(SQLiteDatabase db,long revision,JSONObject initialProfile,LedgerTables.Codec codec)throws Exception{
        requireTransaction(db);
        if(db.getVersion()!=LedgerTables.VERSION||LedgerTables.revision(db,"ledger_revision")!=revision||!DEFAULT_ID.equals(initialProfile.getString("id"))||initialProfile.getBoolean("archived"))throw new IllegalStateException("Invalid migration");
        JSONArray old=LedgerTables.read(db,codec);
        validateRows(old);create(db);saveProfile(db,initialProfile,0,codec);
        replaceRows(db,DEFAULT_ID,new JSONArray(),old,codec);
        verify(readRows(db,DEFAULT_ID,codec),old);
        // Remove v3 only after verifying every encrypted scoped row. SQLite
        // rolls back both the DDL and data if any later operation fails.
        for(int i=TABLES.length-1;i>=0;i--)db.execSQL("DROP TABLE "+LedgerTables.name(TABLES[i]));
        db.setVersion(VERSION);
        advance(db,revision);
        read(db,codec);
    }
    private static void advance(SQLiteDatabase db,long revision){
        ContentValues v=new ContentValues();v.put("revision",revision+1);
        if(db.update("ledger_revision",v,"id=1 AND revision=?",new String[]{Long.toString(revision)})!=1)throw new IllegalStateException("Revision changed");
    }
    static boolean commit(SQLiteDatabase db,long revision,JSONArray proposed,LedgerTables.Codec codec)throws Exception{
        requireTransaction(db);
        if(db.getVersion()!=VERSION)throw new IllegalStateException("Invalid schema");
        if(LedgerTables.revision(db,"ledger_revision")!=revision)return false;
        JSONArray old=read(db,codec);
        if(proposed.length()<old.length()||proposed.length()>100)throw new IllegalArgumentException("Catalog removal is disabled");
        Set<String> ids=new HashSet<>();boolean active=false;
        // Immutable catalog order, no destructive workspace deletion.
        for(int i=0;i<proposed.length();i++){
            JSONObject w=proposed.getJSONObject(i),p=validateProfile(w.getJSONObject("profile"));
            String id=p.getString("id");if(!ids.add(id))throw new IllegalArgumentException("Duplicate workspace");
            active|=!p.getBoolean("archived");
            JSONArray rows=w.getJSONArray("rows");validateRows(rows);
            JSONArray previous=new JSONArray();
            if(i<old.length()){
                JSONObject prior=old.getJSONObject(i),q=prior.getJSONObject("profile");previous=prior.getJSONArray("rows");
                if(!id.equals(q.getString("id"))||!p.getString("createdAt").equals(q.getString("createdAt")))throw new IllegalArgumentException("Workspace identity changed");
                if(q.getBoolean("archived")||p.getBoolean("archived"))verify(previous,rows);
                if(p.getBoolean("archived"))for(int j=0;j<rows.length();j++)if("drafts".equals(rows.getJSONObject(j).getString("table")))throw new IllegalStateException("Archived ledger has a draft");
            }else if(p.getBoolean("archived"))throw new IllegalArgumentException("New ledger must be active");
            saveProfile(db,p,i,codec);replaceRows(db,id,previous,rows,codec);
        }
        if(!active)throw new IllegalStateException("No active ledger");
        advance(db,revision);
        read(db,codec);return true;
    }
}
