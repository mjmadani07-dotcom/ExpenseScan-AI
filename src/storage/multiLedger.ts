import { decodeStoredState,type SnapshotStore,type StoredState } from './sqliteStore';
import { emptyLedger } from './ledgerDomain';
import { attachmentIds,snapshotAttachmentIds } from './attachments';
import { DEFAULT_EXPENSE_FILTERS,filterExpenses,summarizeExpensePayments,getCategoryLabel } from '../utils/finance';
import type { ExpenseFilters,ExpenseRecord } from '../types/expense';

// Logical storage contract; native row schema and app activation are separate steps.
export const DEFAULT_LEDGER_ID='legacy-default';
export const MAX_LEDGERS=100;
export interface LedgerProfile { id:string; name:string; color:string; archived:boolean; createdAt:string; }
export interface LedgerWorkspace { profile:LedgerProfile; state:StoredState; }
export interface MultiLedgerState { version:1; workspaces:LedgerWorkspace[]; }
export interface MultiLedgerStore {
 initialize():Promise<void>;
 read():Promise<{revision:number;state:MultiLedgerState}>;
 compareAndSwap(revision:number,state:MultiLedgerState):Promise<boolean>;
}
const invalid=():never=>{throw new Error('ساختار دفاتر مالی نامعتبر است؛ داده‌ها تغییر نکردند.');};
const nameKey=(name:string)=>name.normalize('NFKC').replace(/ي/g,'ی').replace(/ك/g,'ک').trim().replace(/\s+/g,' ').toLowerCase();
function validateName(value:unknown):string{
 if(typeof value!=='string')return invalid();
 const name=value.trim().replace(/\s+/g,' ');
 if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))return invalid();
 return name;
}
function validateColor(value:unknown):string{
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))return invalid();
 return value.toLowerCase();
}
function checkStored(value:unknown):StoredState{return decodeStoredState(JSON.stringify(value));}
export function validateMultiLedger(input:unknown):MultiLedgerState{
 const v=input as MultiLedgerState;
 if(!v||v.version!==1||!Array.isArray(v.workspaces)||v.workspaces.length<1||v.workspaces.length>MAX_LEDGERS)return invalid();
 const ids=new Set<string>(),names=new Set<string>();
 const workspaces=v.workspaces.map(w=>{
  const p=w?.profile;
  if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.archived!=='boolean'||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt)))return invalid();
  const name=validateName(p.name),key=nameKey(name);
  if(names.has(key))return invalid();
  ids.add(p.id);names.add(key);
  return {profile:{id:p.id,name,color:validateColor(p.color),archived:p.archived,createdAt:p.createdAt},state:checkStored(w.state)};
 });
 if(!workspaces.some(w=>!w.profile.archived))return invalid();
 return {version:1,workspaces};
}
export function migrateSingleLedger(state:StoredState,createdAt:string):MultiLedgerState{
 // Never infer a company/location from existing financial data.
 return validateMultiLedger({version:1,workspaces:[{profile:{id:DEFAULT_LEDGER_ID,name:'دفتر اولیه',color:'#0f766e',archived:false,createdAt},state}]});
}
function find(root:MultiLedgerState,id:string,write=false):LedgerWorkspace{
 const w=root.workspaces.find(x=>x.profile.id===id);
 if(!w)throw new Error('دفتر مالی یافت نشد.');
 if(write&&w.profile.archived)throw new Error('دفتر بایگانی شده است؛ ابتدا آن را فعال کنید.');
 return w;
}
export function createLedger(root:MultiLedgerState,name:string,color:string,createdAt=new Date().toISOString(),id:string=crypto.randomUUID()):MultiLedgerState{
 const next=validateMultiLedger(root);
 next.workspaces.push({profile:{id,name,color,archived:false,createdAt},state:{ledger:emptyLedger(),draft:null,recoveries:[]}});
 return validateMultiLedger(next);
}
export function editLedgerProfile(root:MultiLedgerState,id:string,patch:Partial<Pick<LedgerProfile,'name'|'color'|'archived'>>):MultiLedgerState{
 const next=validateMultiLedger(root),w=find(next,id);
 // Explicit fields only; never permit replacing the stable scope identity.
 if(patch.name!==undefined)w.profile.name=patch.name;
 if(patch.color!==undefined)w.profile.color=patch.color;
 if(patch.archived!==undefined){
  if(patch.archived&&w.state.draft)throw new Error('پیش‌نویس فعال را پیش از بایگانی دفتر تعیین تکلیف کنید.');
  w.profile.archived=patch.archived;
 }
 return validateMultiLedger(next);
}
export async function changeCatalog(store:MultiLedgerStore,change:(root:MultiLedgerState)=>MultiLedgerState){
 const {revision,state}=await store.read();
 const next=validateMultiLedger(change(validateMultiLedger(state)));
 if(!await store.compareAndSwap(revision,next))throw new Error('دفاتر هم‌زمان تغییر کرده‌اند؛ دوباره بارگذاری کنید.');
 return next;
}
// Bind the repository to an immutable ledger ID. Changing the UI selection
// must construct a new scope; queued writes can never follow that selection.
// Native implementation must provide global CAS and all-workspace attachment GC.
export class ScopedLedgerStore implements SnapshotStore {
 constructor(private readonly parent:MultiLedgerStore,readonly ledgerId:string){}
 initialize(){return this.parent.initialize();}
 async read(){
  const {revision,state}=await this.parent.read();
  return {revision,state:structuredClone(find(validateMultiLedger(state),this.ledgerId,true).state)};
 }
 async readActive(){
  const {state}=await this.read();
  return {ledger:state.ledger,draft:state.draft};
 }
 async compareAndSwap(revision:number,state:StoredState){
  const current=await this.parent.read();
  if(current.revision!==revision)return false;
  const next=validateMultiLedger(current.state);
  find(next,this.ledgerId,true).state=checkStored(state);
  return this.parent.compareAndSwap(revision,validateMultiLedger(next));
 }
}
// Global GC protection includes all ledgers, even archived, plus every
// workspace's draft, recovery checkpoints and replay acknowledgement.
export function multiLedgerAttachmentIds(root:MultiLedgerState):string[]{
 const result=new Set<string>();
 for(const w of validateMultiLedger(root).workspaces){
  const s=w.state;
  for(const id of snapshotAttachmentIds(s.ledger,s.draft))result.add(id);
  for(const r of s.recoveries??[])for(const id of snapshotAttachmentIds(r.ledger,r.draft))result.add(id);
  for(const id of attachmentIds(s.lastApproval?.records??[]))result.add(id);
 }
 return [...result].sort();
}
export interface ConsolidatedRow {
 ledgerId:string;ledgerName:string;expense:ExpenseRecord;categoryLabel:string;
 totalIRT:number;paidIRT:number;remainingIRT:number;
}
export function consolidateLedgers(root:MultiLedgerState,ledgerIds:readonly string[],filters:ExpenseFilters=DEFAULT_EXPENSE_FILTERS,referenceDate=new Date()){
 const state=validateMultiLedger(root);
 if(!Array.isArray(ledgerIds)||!ledgerIds.length||new Set(ledgerIds).size!==ledgerIds.length)throw new Error('دفاتر گزارش را به‌صورت مشخص و بدون تکرار انتخاب کنید.');
 // Category IDs are local to each ledger, so a global category ID is ambiguous.
 // A future per-ledger category selection can be mapped before aggregation.
 if(filters.category!=='all'&&ledgerIds.length>1)throw new Error('فیلتر دسته‌بندی در گزارش چند دفتر باید به تفکیک دفتر تعریف شود.');
 const rows:ConsolidatedRow[]=[];
 const byLedger=ledgerIds.map(id=>{
  const w=find(state,id),l=w.state.ledger;
  const records=filterExpenses(l.expenses,filters,referenceDate,l.rates);
  const entries=records.map(expense=>{
   const {totalIRT,paidIRT,remainingIRT}=summarizeExpensePayments(expense,l.rates);
   return {ledgerId:id,ledgerName:w.profile.name,expense:structuredClone(expense),categoryLabel:getCategoryLabel(expense.category,l.categories),totalIRT,paidIRT,remainingIRT};
  });
  rows.push(...entries);
  return {ledgerId:id,ledgerName:w.profile.name,count:entries.length,...totals(entries)};
 });
 const tie=(a:ConsolidatedRow,b:ConsolidatedRow)=>a.ledgerId.localeCompare(b.ledgerId)||a.expense.id.localeCompare(b.expense.id);
 rows.sort((a,b)=>{
  let diff=0;
  switch(filters.sortBy){
   case 'amount_desc':diff=b.totalIRT-a.totalIRT;break;
   case 'amount_asc':diff=a.totalIRT-b.totalIRT;break;
   case 'created_desc':diff=b.expense.createdAt.localeCompare(a.expense.createdAt);break;
   case 'date_asc':diff=a.expense.date.localeCompare(b.expense.date);break;
   default:diff=b.expense.date.localeCompare(a.expense.date);
  }
  return diff||tie(a,b);
 });
 return {rows,byLedger,count:rows.length,...totals(rows)};
}
function totals(rows:readonly ConsolidatedRow[]){
 return rows.reduce((sum,row)=>({totalIRT:sum.totalIRT+row.totalIRT,paidIRT:sum.paidIRT+row.paidIRT,remainingIRT:sum.remainingIRT+row.remainingIRT}),{totalIRT:0,paidIRT:0,remainingIRT:0});
}
