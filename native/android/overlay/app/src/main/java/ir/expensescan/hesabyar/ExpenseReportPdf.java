package ir.expensescan.hesabyar;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;

final class ExpenseReportPdf {
    private static final int W=842,H=595,M=24,BOTTOM=555;
    private static final int[] WIDTHS={70,200,104,118,110,110,82};
    private static final String[] HEADERS={"تاریخ","شرح / فروشنده","حوزه هزینه","مبلغ کل","پرداخت‌شده","مانده","وضعیت"};
    private static final int TEAL=Color.rgb(15,118,110),INK=Color.rgb(15,23,42);
    private static StaticLayout layout(String text,int width,int size,int color,boolean bold){
        TextPaint paint=new TextPaint(Paint.ANTI_ALIAS_FLAG);paint.setTextSize(size);paint.setColor(color);
        paint.setTypeface(Typeface.create("sans-serif",bold?Typeface.BOLD:Typeface.NORMAL));
        return StaticLayout.Builder.obtain(text,0,text.length(),paint,width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setTextDirection(TextDirectionHeuristics.RTL)
            .setIncludePad(false).build();
    }
    private static String checked(String s,int max){if(s.length()>max)throw new IllegalArgumentException("Text too long");return s;}
    private static void draw(Canvas canvas,StaticLayout text,int x,int y){canvas.save();canvas.translate(x,y);text.draw(canvas);canvas.restore();}
    private static void rect(Canvas canvas,int x,int y,int w,int h,int color){
        Paint p=new Paint();p.setColor(color);canvas.drawRect(x,y,x+w,y+h,p);
    }
    private static int line(Canvas c,String text,int y,int size,boolean bold){
        StaticLayout l=layout(text,W-2*M,size,INK,bold);draw(c,l,M,y);return y+l.getHeight()+5;
    }
    private static int cells(Canvas c,String[] values,int y,boolean header,boolean odd,boolean measure){
        StaticLayout[] layouts=new StaticLayout[WIDTHS.length];int height=26;
        for(int i=0;i<WIDTHS.length;i++){
            layouts[i]=layout(checked(values[i],1500),WIDTHS[i]-12,header?10:11,header?Color.WHITE:INK,header);
            height=Math.max(height,layouts[i].getHeight()+12);
        }
        if(measure)return height;
        int right=W-M;
        for(int i=0;i<WIDTHS.length;i++){
            int x=right-WIDTHS[i];rect(c,x,y,WIDTHS[i],height,header?TEAL:odd?Color.rgb(241,245,249):Color.WHITE);
            draw(c,layouts[i],x+6,y+6);right=x;
        }
        return height;
    }
    private static PdfDocument.Page page(PdfDocument doc,int n){return doc.startPage(new PdfDocument.PageInfo.Builder(W,H,n).create());}
    private static int top(Canvas c,JSONObject r,int n)throws Exception{
        int y=line(c,checked(r.getString("title"),120),M,19,true);
        y=line(c,checked(r.getString("scope"),300)+"  |  تاریخ گزارش: "+checked(r.getString("date"),30),y,11,false);
        y=line(c,"تعداد اسناد: "+checked(r.getString("count"),20)+"  |  واحد: "+checked(r.getString("unit"),30),y,11,false);
        y=line(c,"جمع: "+checked(r.getString("total"),100)+"  |  پرداخت: "+checked(r.getString("paid"),100)+"  |  مانده: "+checked(r.getString("remaining"),100),y,12,true);
        draw(c,layout("صفحه "+n+"  •  حساب‌یار",W-2*M,10,INK,false),M,H-24);
        String[] headers=HEADERS;
        if(r.has("headers")){
            JSONArray custom=r.getJSONArray("headers");
            if(custom.length()!=WIDTHS.length)throw new IllegalArgumentException("Invalid headers");
            headers=new String[WIDTHS.length];for(int i=0;i<headers.length;i++)headers[i]=checked(custom.getString(i),60);
        }
        return y+cells(c,headers,y,true,false,false);
    }
    static byte[] render(JSONObject r)throws Exception{
        JSONArray rows=r.getJSONArray("rows");if(rows.length()>2000)throw new IllegalArgumentException("Too many records");
        PdfDocument doc=new PdfDocument();PdfDocument.Page current=null;
        try{
            int n=1;current=page(doc,n);int y=top(current.getCanvas(),r,n);
            for(int i=0;i<rows.length();i++){
                JSONArray row=rows.getJSONArray(i);if(row.length()!=WIDTHS.length)throw new IllegalArgumentException("Bad row");
                String[] values=new String[WIDTHS.length];for(int j=0;j<values.length;j++)values[j]=row.getString(j);
                int h=cells(null,values,0,false,false,true);
                if(y+h>BOTTOM){doc.finishPage(current);current=null;current=page(doc,++n);y=top(current.getCanvas(),r,n);}
                if(y+h>BOTTOM)throw new IllegalArgumentException("Row cannot fit page");
                y+=cells(current.getCanvas(),values,y,false,i%2==1,false);
            }
            doc.finishPage(current);current=null;
            ByteArrayOutputStream out=new ByteArrayOutputStream();doc.writeTo(out);
            if(out.size()>24*1024*1024)throw new IllegalArgumentException("PDF too large");
            return out.toByteArray();
        }finally{if(current!=null)doc.finishPage(current);doc.close();}
    }
}
