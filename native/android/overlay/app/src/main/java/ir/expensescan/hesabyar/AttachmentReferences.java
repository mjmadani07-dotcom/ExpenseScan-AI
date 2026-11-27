package ir.expensescan.hesabyar;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

// Only inspect the domain fields that actually carry attachment references.
final class AttachmentReferences {
    static boolean eligible(String id,Set<String> protectedIds,long touched,long now,boolean sidecar){
        return id.matches("[a-f0-9]{64}")&&!protectedIds.contains(id)&&touched>0&&touched<=now-24L*60*60*1000&&!sidecar;
    }
    private static void record(JSONObject row,Set<String> ids)throws Exception{
        boolean hasId=!row.isNull("attachmentId"),hasMime=!row.isNull("attachmentMime");
        if(hasId!=hasMime)throw new IllegalStateException("Incomplete attachment reference");
        if(!hasId)return;
        String id=row.getString("attachmentId"),mime=row.getString("attachmentMime");
        if(!id.matches("[a-f0-9]{64}")||!mime.matches("application/pdf|image/(jpeg|png|webp|gif)|text/(plain|csv)"))throw new IllegalStateException("Invalid attachment reference");
        ids.add(id);
    }
    private static void records(JSONArray records,Set<String> ids)throws Exception{
        for(int i=0;i<records.length();i++)record(records.getJSONObject(i),ids);
    }
    private static void draft(JSONObject draft,Set<String> ids)throws Exception{
        records(draft.getJSONArray("drafts"),ids);
    }
    static Set<String> fromRows(JSONArray rows)throws Exception{
        Set<String> ids=new HashSet<>();
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.getJSONObject(i);String t=row.getString("table");
            if(!t.equals("expenses")&&!t.equals("drafts")&&!t.equals("recoveries")&&!t.equals("approval"))continue;
            JSONObject data=new JSONObject(row.getString("data"));
            switch(t){
                case "expenses":record(data.getJSONObject("header"),ids);break;
                case "drafts":draft(data,ids);break;
                case "recoveries":
                    records(data.getJSONObject("ledger").getJSONArray("expenses"),ids);
                    if(!data.has("draft"))throw new IllegalStateException("Invalid recovery");
                    if(!data.isNull("draft"))draft(data.getJSONObject("draft"),ids);
                    break;
                case "approval":records(data.getJSONArray("records"),ids);break;
            }
        }
        return ids;
    }
}
