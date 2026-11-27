import {consolidateLedgers,type MultiLedgerState} from '../storage/multiLedger';
import type {DisplayUnit,ExpenseFilters,TimeframeFilter} from '../types/expense';
import {DEFAULT_EXPENSE_FILTERS,CURRENCY_LABELS,PAYMENT_STATUS_LABELS,convertTomanToDisplayUnit,formatCurrency} from './finance';
import {businessDateIso,formatJalaliDate,parseIsoDate,toPersianDigits} from './jalali';
export interface ReportSelection {
 ledgerIds:string[];timeframe:TimeframeFilter;dateFrom?:string;dateTo?:string;query:string;
 paymentStatus:ExpenseFilters['paymentStatus'];sortBy:ExpenseFilters['sortBy'];
}
export const REPORT_PERIODS:Record<TimeframeFilter,string>={'1m':'یک ماه اخیر','3m':'سه ماه اخیر','6m':'شش ماه اخیر','12m':'دوازده ماه اخیر','all':'همه تاریخ‌ها'};
export function makeConsolidatedReport(root:MultiLedgerState,selection:ReportSelection,at=new Date()){
 const {ledgerIds,timeframe,dateFrom,dateTo,query,paymentStatus,sortBy}=selection;
 if(!Object.hasOwn(REPORT_PERIODS,timeframe)||!['all',...Object.keys(PAYMENT_STATUS_LABELS)].includes(paymentStatus)||!['date_desc','date_asc','created_desc','amount_desc','amount_asc'].includes(sortBy))throw new Error('فیلتر گزارش نامعتبر است.');
 if((dateFrom&&!parseIsoDate(dateFrom))||(dateTo&&!parseIsoDate(dateTo))||(dateFrom&&dateTo&&dateFrom>dateTo))throw new Error('بازه تاریخ گزارش نامعتبر است.');
 if(timeframe!=='all'&&(dateFrom||dateTo))throw new Error('بازه نسبی و تاریخ سفارشی را هم‌زمان انتخاب نکنید.');
 const result=consolidateLedgers(root,ledgerIds,{...DEFAULT_EXPENSE_FILTERS,timeframe,dateFrom,dateTo,query,paymentStatus,sortBy},at);
 const period=dateFrom||dateTo?'از '+(dateFrom?formatJalaliDate(dateFrom):'ابتدا')+' تا '+(dateTo?formatJalaliDate(dateTo):'انتها'):REPORT_PERIODS[timeframe];
 return {...result,generatedDate:businessDateIso(at),selection:structuredClone(selection),period,paymentLabel:paymentStatus==='all'?'همه وضعیت‌ها':PAYMENT_STATUS_LABELS[paymentStatus]};
}
export type ConsolidatedReport=ReturnType<typeof makeConsolidatedReport>;
export const reportMoney=(n:number,unit:DisplayUnit)=>formatCurrency(convertTomanToDisplayUnit(n,unit),unit);
export function buildConsolidatedPdf(report:ConsolidatedReport,unit:DisplayUnit){
 if(report.rows.length+report.byLedger.length>2000)throw new Error('برای PDF بازه گزارش را محدود کنید (حداکثر ۲۰۰۰ ردیف با خلاصه دفاتر).');
 const m=(n:number)=>reportMoney(n,unit);
 // Selected ledger summaries are always present, even if zero matching documents.
 // This records the exact selection without a truncatable comma-separated name list.
 const rows=[...report.byLedger.map(l=>['—','خلاصه دفتر · '+toPersianDigits(l.count)+' سند',l.ledgerName,m(l.totalIRT),m(l.paidIRT),m(l.remainingIRT),'خلاصه']),
 ...report.rows.map(r=>[formatJalaliDate(r.expense.date),r.expense.title+'\n'+r.expense.vendor+'\n'+r.categoryLabel,r.ledgerName,m(r.totalIRT),m(r.paidIRT),m(r.remainingIRT),PAYMENT_STATUS_LABELS[r.expense.paymentStatus]])];
 return {title:'گزارش تلفیقی دفاتر مالی',scope:report.period+' | '+report.paymentLabel+' | '+toPersianDigits(report.byLedger.length)+' دفتر'+(report.selection.query?' | دارای فیلتر جست‌وجو':''),date:formatJalaliDate(report.generatedDate),unit:CURRENCY_LABELS[unit],count:toPersianDigits(report.count),total:m(report.totalIRT),paid:m(report.paidIRT),remaining:m(report.remainingIRT),headers:['تاریخ','شرح / فروشنده / حوزه','دفتر مالی','مبلغ کل','پرداخت‌شده','مانده','وضعیت'],rows};
}
