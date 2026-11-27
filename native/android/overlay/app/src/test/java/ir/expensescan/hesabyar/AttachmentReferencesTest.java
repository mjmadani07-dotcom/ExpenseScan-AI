package ir.expensescan.hesabyar;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Set;
import static org.junit.Assert.*;

public class AttachmentReferencesTest {
    private static final String A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String C="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    private static final String D="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    private static JSONObject attachment(String id)throws Exception{return new JSONObject().put("attachmentId",id).put("attachmentMime","application/pdf");}
    private static JSONObject row(String table,JSONObject data)throws Exception{return new JSONObject().put("table",table).put("data",data.toString());}
    @Test public void protectsReferencesInEveryStoredScope()throws Exception{
        JSONArray rows=new JSONArray()
            .put(row("expenses",new JSONObject().put("header",attachment(A))))
            .put(row("drafts",new JSONObject().put("drafts",new JSONArray().put(attachment(B)))))
            .put(row("recoveries",new JSONObject().put("ledger",new JSONObject().put("expenses",new JSONArray().put(attachment(C)))).put("draft",new JSONObject().put("drafts",new JSONArray().put(attachment(D))))))
            .put(row("approval",new JSONObject().put("records",new JSONArray().put(attachment(A)))));
        assertEquals(Set.of(A,B,C,D),AttachmentReferences.fromRows(rows));
    }
    @Test public void invalidReferencesFailClosed()throws Exception{
        try{AttachmentReferences.fromRows(new JSONArray().put(row("expenses",new JSONObject().put("header",new JSONObject().put("attachmentId",A)))));fail("Incomplete attachment should fail");}
        catch(IllegalStateException expected){}
        try{AttachmentReferences.fromRows(new JSONArray().put(row("recoveries",new JSONObject().put("ledger",new JSONObject().put("expenses",new JSONArray())))));fail("Missing recovery draft should fail");}
        catch(IllegalStateException expected){}
    }
    @Test public void cleanupEligibilityProtectsReferencedRecentAndPartialFiles(){
        long now=200000000L,old=now-24L*60*60*1000;
        assertTrue(AttachmentReferences.eligible(A,Set.of(B),old,now,false));
        assertFalse(AttachmentReferences.eligible(B,Set.of(B),old,now,false));
        assertFalse(AttachmentReferences.eligible(A,Set.of(),old+1,now,false));
        assertFalse(AttachmentReferences.eligible(A,Set.of(),old,now,true));
        assertFalse(AttachmentReferences.eligible(A,Set.of(),0,now,false));
        assertFalse(AttachmentReferences.eligible("../invalid",Set.of(),old,now,false));
    }
}
