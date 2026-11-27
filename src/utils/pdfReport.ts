import type {CategoryDefinition,DisplayUnit,ExchangeRates,ExpenseRecord} from '../types/expense';
import {CURRENCY_LABELS,PAYMENT_STATUS_LABELS,formatCurrency,convertTomanToDisplayUnit,getCategoryLabel,summarizeExpensePayments} from './finance';
import {businessDateIso,formatJalaliDate,toPersianDigits} from './jalali';
import {nativeSaveReportPdf} from '../storage/androidSnapshotStore';
export function buildPdfReport(expenses:ExpenseRecord[],rates:ExchangeRates,unit:DisplayUnit,categories:CategoryDefinition[],title:string,scope:string){
 if(expenses.length>2000)throw new Error('برای گزارش PDF بیش از ۲۰۰۰ سند، بازه یا فیلتر گزارش را محدود کنید.');
 const money=(n:number)=>formatCurrency(convertTomanToDisplayUnit(n,unit),unit);
 let total=0,paid=0,remaining=0;
 const rows=expenses.map(e=>{
   const p=summarizeExpensePayments(e,rates);
   total+=p.totalIRT;paid+=p.paidIRT;remaining+=p.remainingIRT;
   return [formatJalaliDate(e.date),e.title+'\n'+e.vendor,getCategoryLabel(e.category,categories),money(p.totalIRT),money(p.paidIRT),money(p.remainingIRT),PAYMENT_STATUS_LABELS[e.paymentStatus]];
 });
 return {title,scope,date:formatJalaliDate(businessDateIso()),unit:CURRENCY_LABELS[unit],count:toPersianDigits(expenses.length),total:money(total),paid:money(paid),remaining:money(remaining),rows};
}
export async function downloadExpensePdf(expenses:ExpenseRecord[],rates:ExchangeRates,unit:DisplayUnit,categories:CategoryDefinition[],title:string,scope:string){
 if(!window.confirm('گزارش PDF بدون رمزگذاری در مسیر انتخابی ذخیره خواهد شد. ادامه می‌دهید؟'))return;
 await nativeSaveReportPdf('hesabyar-report-'+businessDateIso()+'.pdf',buildPdfReport(expenses,rates,unit,categories,title,scope));
}
