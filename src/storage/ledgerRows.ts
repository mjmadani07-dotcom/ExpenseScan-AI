import { decodeStoredState,type StoredState } from './sqliteStore';
import type { ExpenseRecord,LedgerData } from '../types/expense';

// Order is part of the native bridge contract: parent tables precede children.
export const ROW_TABLES=['meta','categories','budgets','rates','expenses','line_items','payment_tranches','drafts','recoveries','approval'] as const;
export type RowTable=typeof ROW_TABLES[number];
export interface LedgerRow {table:RowTable;id:string;parent:string|null;data:string;}
export interface RowKey {table:RowTable;id:string;}
export interface RowPatch {upserts:LedgerRow[];deletes:RowKey[];}
const fail=():never=>{throw new Error('ساختار جداول دفتر مالی نامعتبر است؛ داده‌ها تغییر نکردند.');};
function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));
 return value;
}
export const canonicalJson=(value:unknown)=>JSON.stringify(stable(JSON.parse(JSON.stringify(value))));
const key=(table:RowTable,id:string)=>JSON.stringify([table,id]);
const childId=(id:string,index:number)=>JSON.stringify([id,index]);
function validId(id:unknown):id is string{return typeof id==='string'&&id.length>0&&id.length<=4096&&!id.includes('\u0000');}
function ids(value:unknown):string[]{if(!Array.isArray(value)||value.some(x=>!validId(x))||new Set(value).size!==value.length)return fail();return value;}
export function partitionLedger(input:StoredState):LedgerRow[]{
 const s=decodeStoredState(JSON.stringify(input));const rows:LedgerRow[]=[];
 const push=(table:RowTable,id:string,value:unknown,parent:string|null=null)=>{if(!validId(id)||(parent!==null&&!validId(parent)))fail();rows.push({table,id,parent,data:canonicalJson(value)});};
 const l=s.ledger;
 push('meta','state',{expenseIds:l.expenses.map(x=>x.id),categoryIds:l.categories!.map(x=>x.id),budgetIds:l.budgets.map(x=>x.category),recoveryIds:(s.recoveries??[]).map(x=>x.id),hasDraft:s.draft!==null,hasApproval:!!s.lastApproval,aiConfig:l.aiConfig});
 for(const c of l.categories!)push('categories',c.id,c);
 for(const b of l.budgets)push('budgets',b.category,b);
 for(const k of ['USD','EUR'] as const)push('rates',k,l.rates[k]);
 for(const exp of l.expenses){
  const {lineItems,paymentTranches,...header}=exp;
  push('expenses',exp.id,{header,lineCount:lineItems.length,trancheCount:paymentTranches===undefined?null:paymentTranches.length});
  lineItems.forEach((v,i)=>push('line_items',childId(exp.id,i),v,exp.id));
  paymentTranches?.forEach((v,i)=>push('payment_tranches',childId(exp.id,i),v,exp.id));
 }
 if(s.draft)push('drafts','active',s.draft);
 for(const r of s.recoveries??[])push('recoveries',r.id,r);
 if(s.lastApproval)push('approval','last',s.lastApproval);
 return rows;
}
export function assembleLedger(rows:LedgerRow[],scope:'all'|'active'='all'):StoredState{
 if(!Array.isArray(rows))return fail();
 const map=new Map<string,LedgerRow>();
 for(const r of rows){if(!r||!ROW_TABLES.includes(r.table)||!validId(r.id)||typeof r.data!=='string'||(r.parent!==null&&!validId(r.parent))||map.has(key(r.table,r.id)))fail();map.set(key(r.table,r.id),r);}
 function take(table:RowTable,id:string,parent:string|null=null):any{
  const k=key(table,id),r=map.get(k);if(!r||r.parent!==parent)return fail();map.delete(k);return JSON.parse(r.data);
 }
 const m=take('meta','state');
 if(!m||typeof m.hasDraft!=='boolean'||typeof m.hasApproval!=='boolean')fail();
 const expenses:ExpenseRecord[]=ids(m.expenseIds).map(id=>{
  const x=take('expenses',id);
  if(!x||x.header?.id!==id||!Number.isSafeInteger(x.lineCount)||x.lineCount<0||x.lineCount>100000||!(x.trancheCount===null||Number.isSafeInteger(x.trancheCount)&&x.trancheCount>=0&&x.trancheCount<=100000))return fail();
  const lineItems=Array.from({length:x.lineCount},(_,i)=>take('line_items',childId(id,i),id));
  const paymentTranches=x.trancheCount===null?undefined:Array.from({length:x.trancheCount},(_,i)=>take('payment_tranches',childId(id,i),id));
  return {...x.header,lineItems,paymentTranches};
 });
 const categories=ids(m.categoryIds).map(id=>{const c=take('categories',id);if(c?.id!==id)fail();return c;});
 const budgets=ids(m.budgetIds).map(id=>{const b=take('budgets',id);if(b?.category!==id)fail();return b;});
 const ledger:LedgerData={expenses,categories,budgets,rates:{USD:take('rates','USD'),EUR:take('rates','EUR')},aiConfig:m.aiConfig};
 const recoveryIds=ids(m.recoveryIds);
 if(recoveryIds.length>3)fail();
 const recoveries=scope==='all'?recoveryIds.map(id=>{const r=take('recoveries',id);if(r?.id!==id)fail();return r;}):[];
 const draft=m.hasDraft?take('drafts','active'):null,lastApproval=scope==='all'&&m.hasApproval?take('approval','last'):undefined;
 if((m.hasDraft&&!draft)||(scope==='all'&&m.hasApproval&&!lastApproval)||map.size)fail();
 return decodeStoredState(JSON.stringify({ledger,draft,recoveries,lastApproval}));
}
export function diffLedgerRows(before:LedgerRow[],after:LedgerRow[]):RowPatch{
 const previous=new Map(before.map(r=>[key(r.table,r.id),r]));
 const upserts:LedgerRow[]=[];
 for(const r of after){const k=key(r.table,r.id),old=previous.get(k);if(!old||old.data!==r.data||old.parent!==r.parent)upserts.push(r);previous.delete(k);}
 return {upserts,deletes:[...previous.values()].map(({table,id})=>({table,id}))};
}
