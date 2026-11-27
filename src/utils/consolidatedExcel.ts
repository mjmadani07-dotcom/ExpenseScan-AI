import XLSX from 'xlsx-js-style';
import type {DisplayUnit} from '../types/expense';
import {CURRENCY_LABELS,PAYMENT_STATUS_LABELS,convertTomanToDisplayUnit} from './finance';
import {formatJalaliDate} from './jalali';
import type {ConsolidatedReport} from './consolidatedReport';
type Cell=string|number;
function sheet(rows:Cell[][],widths:number[],header:number,numeric:number[]){
 const ws=XLSX.utils.aoa_to_sheet(rows);
 ws['!cols']=widths.map(wch=>({wch}));
 (ws as Record<string,unknown>)['!views']=[{rightToLeft:true}];
 for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){
  const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell)continue;
  // aoa_to_sheet treats strings as literal strings, not formulas.
  cell.s={font:{name:'Tahoma',sz:10,bold:r===header||r===0,color:{rgb:r===header?'FFFFFF':'0F172A'}},fill:{fgColor:{rgb:r===header?'0F766E':r%2?'F1F5F9':'FFFFFF'}},alignment:{vertical:'center',horizontal:'right',readingOrder:2,wrapText:true},...(r>header&&numeric.includes(c)&&typeof rows[r][c]==='number'?{numFmt:'#,##0.0#'}:{})};
 }
 ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:header,c:0},e:{r:Math.max(header,rows.length-1),c:widths.length-1}})};
 return ws;
}
export function buildConsolidatedWorkbook(report:ConsolidatedReport,unit:DisplayUnit){
 if(report.rows.length>10000)throw new Error('برای Excel بازه گزارش را به حداکثر ۱۰۰۰۰ سند محدود کنید.');
 const u=CURRENCY_LABELS[unit],n=(v:number)=>convertTomanToDisplayUnit(v,unit);
 const wb=XLSX.utils.book_new();wb.Workbook={Views:[{RTL:true}]};
 const metadata:Cell[][]=[['گزارش تلفیقی دفاتر مالی'],['تاریخ گزارش',formatJalaliDate(report.generatedDate)],['بازه',report.period],['وضعیت',report.paymentLabel],['عبارت جست‌وجو',report.selection.query],['واحد پول',u],['تعداد اسناد',report.count],['مبلغ کل',n(report.totalIRT)],['پرداخت‌شده',n(report.paidIRT)],['مانده',n(report.remainingIRT)],['دفتر مالی','شناسه دفتر','تعداد اسناد','مبلغ کل ('+u+')','پرداخت‌شده ('+u+')','مانده ('+u+')'],...report.byLedger.map(l=>[l.ledgerName,l.ledgerId,l.count,n(l.totalIRT),n(l.paidIRT),n(l.remainingIRT)])];
 XLSX.utils.book_append_sheet(wb,sheet(metadata,[30,38,15,22,22,22],10,[2,3,4,5]),'خلاصه دفاتر');
 const detail:Cell[][]=[['دفتر مالی','شناسه دفتر','شناسه سند','تاریخ شمسی','شرح','فروشنده','حوزه','مبلغ کل ('+u+')','پرداخت‌شده ('+u+')','مانده ('+u+')','وضعیت','مبلغ اصلی','ارز اصلی'],...report.rows.map(r=>[r.ledgerName,r.ledgerId,r.expense.id,formatJalaliDate(r.expense.date),r.expense.title,r.expense.vendor,r.categoryLabel,n(r.totalIRT),n(r.paidIRT),n(r.remainingIRT),PAYMENT_STATUS_LABELS[r.expense.paymentStatus],r.expense.amount,CURRENCY_LABELS[r.expense.currency]])];
 XLSX.utils.book_append_sheet(wb,sheet(detail,[26,38,38,18,42,30,24,22,22,22,18,20,14],0,[7,8,9,11]),'جزئیات اسناد');
 return wb;
}
export function consolidatedExcelBytes(report:ConsolidatedReport,unit:DisplayUnit){
 const out=XLSX.write(buildConsolidatedWorkbook(report,unit),{bookType:'xlsx',type:'array'}) as ArrayBuffer|Uint8Array;
 return out instanceof Uint8Array?out:new Uint8Array(out);
}
