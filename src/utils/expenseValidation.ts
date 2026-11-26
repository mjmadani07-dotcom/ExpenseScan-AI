import type { ExpenseFields, ExpenseRecord, ExchangeRates, CategoryDefinition } from '../types/expense';
import { derivePaymentStatusFromTranches } from './finance';
import { parseIsoDate } from './jalali';

export class ExpenseValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ExpenseValidationError'; }
}
const fail = (field: string): never => { throw new ExpenseValidationError(`مقدار نامعتبر: ${field}`); };
const required = ['title','vendor','documentType','category','costCenter','amount','currency','taxAmount','discountAmount','date','paymentMethod','paymentStatus','lineItems','sourceType'];
const optional = ['vendorTaxId','exchangeRateToToman','invoiceNumber','trackingCode','paymentTranches','dueDate','purchaser','projectTag','notes','extractionNotes','sourceFileName','sourcePreviewUrl','pageCount'];
const keys = new Set([...required,...optional]);
const methods = ['corporate_card','personal_card','bank_transfer','petty_cash','online_gateway','cash','check'];
function obj(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  return value as Record<string, unknown>;
}
function amount(value: unknown, field: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > Number.MAX_SAFE_INTEGER) return fail(field);
  return value;
}
function money(value: unknown, field: string, currency: string, positive = false): number {
  const n = amount(value, field, positive);
  const scale = currency === 'IRR' ? 1 : currency === 'IRT' ? 10 : 100;
  const minor = n * scale;
  if (!Number.isSafeInteger(Math.round(minor)) || Math.abs(minor - Math.round(minor)) > 0.00001) return fail(field + ' (دقت پولی)');
  return n;
}
function str(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) fail(field);
}
function one(value: unknown, allowed: string[], field: string) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(field);
}
function date(value: unknown, field: string) {
  if (typeof value !== 'string' || !parseIsoDate(value)) fail(field);
}
function exactKeys(value: Record<string, unknown>, allowed: Set<string>, field: string) {
  for (const k of Object.keys(value)) if (!allowed.has(k)) fail(field + '.' + k);
}
export function validateExpenseFields(raw: unknown, categories: CategoryDefinition[], rates: ExchangeRates): ExpenseFields {
  const v = obj(raw, 'سند');
  exactKeys(v, keys, 'سند');
  for (const k of required) if (!(k in v)) fail(k);
  str(v.title,'عنوان'); str(v.vendor,'فروشنده');
  one(v.documentType,['invoice','receipt','bank_transfer','bill','proforma','payroll','petty_cash','other'],'نوع سند');
  one(v.category,categories.map(c=>c.id),'دسته‌بندی');
  one(v.costCenter,['engineering','sales','operations','finance','executive','general'],'مرکز هزینه');
  one(v.currency,['IRR','IRT','USD','EUR'],'واحد پول');
  const currency = v.currency as string;
  const total = money(v.amount,'مبلغ',currency,true);
  money(v.taxAmount,'مالیات',currency); money(v.discountAmount,'تخفیف',currency);
  date(v.date,'تاریخ سند');
  if (v.dueDate !== undefined) date(v.dueDate,'سررسید');
  one(v.paymentMethod,methods,'روش پرداخت');
  one(v.paymentStatus,['paid','partial','pending','overdue'],'وضعیت پرداخت');
  one(v.sourceType,['image','pdf','text','text_file'],'نوع منبع');
  for (const k of optional.filter(k=>!['exchangeRateToToman','paymentTranches','dueDate','pageCount'].includes(k))) {
    if (v[k] !== undefined && typeof v[k] !== 'string') fail(k);
  }
  if (v.pageCount !== undefined && (!Number.isSafeInteger(v.pageCount) || Number(v.pageCount) < 1)) fail('pageCount');
  if (v.sourcePreviewUrl !== undefined && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(String(v.sourcePreviewUrl))) fail('sourcePreviewUrl');
  if (!Array.isArray(v.lineItems)) return fail('اقلام');
  for (const rawItem of v.lineItems) {
    const item = obj(rawItem,'قلم');
    exactKeys(item,new Set(['description','quantity','unitPrice','totalPrice']),'قلم');
    str(item.description,'شرح قلم'); amount(item.quantity,'تعداد',true);
    money(item.unitPrice,'فی',currency); money(item.totalPrice,'جمع قلم',currency);
  }
  let tranches = v.paymentTranches as ExpenseFields['paymentTranches'];
  if (v.paymentTranches !== undefined) {
    if (!Array.isArray(v.paymentTranches)) return fail('اقساط');
    let sum=0; const ids=new Set<string>();
    for (const rawTr of v.paymentTranches) {
      const tr=obj(rawTr,'قسط');
      exactKeys(tr,new Set(['id','title','amount','method','status','date','referenceCode','notes']),'قسط');
      str(tr.id,'شناسه قسط'); str(tr.title,'عنوان قسط');
      if(ids.has(String(tr.id))) fail('شناسه تکراری قسط');
      ids.add(String(tr.id));
      sum+=money(tr.amount,'مبلغ قسط',currency);
      one(tr.method,methods,'روش قسط'); one(tr.status,['paid','pending','overdue'],'وضعیت قسط');
      if(tr.date!==undefined) date(tr.date,'تاریخ قسط');
      for (const k of ['referenceCode','notes']) if(tr[k]!==undefined && typeof tr[k]!=='string') fail(k);
    }
    if(sum > total + Math.max(1e-8,total*Number.EPSILON*4)) fail('جمع اقساط بیشتر از مبلغ سند');
    if(tranches?.length===0) tranches=undefined;
  }
  const foreign = currency==='USD'||currency==='EUR';
  const rate=foreign ? amount(v.exchangeRateToToman ?? rates[currency as 'USD'|'EUR'],'نرخ تسعیر',true) : undefined;
  const fields=v as unknown as ExpenseFields;
  return {...fields, title:fields.title.trim(),vendor:fields.vendor.trim(), exchangeRateToToman:rate, paymentTranches:tranches, paymentStatus:derivePaymentStatusFromTranches(total,tranches,fields.paymentStatus)};
}
export function validateExpensePatch(current: ExpenseRecord, raw: unknown, categories: CategoryDefinition[], rates: ExchangeRates): ExpenseRecord {
  const patch=obj(raw,'ویرایش');
  exactKeys(patch,keys,'ویرایش');
  const normalized = {...patch};
  for (const k of optional) if (normalized[k] === null) normalized[k] = undefined;
  const {id,createdAt,approvedAt,...fields}=current;
  return {...validateExpenseFields({...fields,...normalized},categories,rates),id,createdAt,approvedAt};
}
