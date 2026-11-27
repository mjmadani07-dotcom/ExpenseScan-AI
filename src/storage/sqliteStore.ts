import type { LedgerData } from '../types/expense';
import { emptyLedger, sanitizeAiConfig } from './ledgerDomain';
import { parseAndValidateLedgerImport } from '../utils/finance';
import { attachmentIds } from './attachments';
import type { DraftSession } from './ledgerRepository';

export type SqlValue=string|number|null;
export interface SqliteExecutor {
  query<T>(sql:string,params?:SqlValue[]):Promise<T[]>;
  run(sql:string,params?:SqlValue[]):Promise<{changes:number}>;
}
export interface SqliteDriver extends SqliteExecutor {
  // Must serialize operations and commit/rollback the whole callback on one connection.
  transaction<T>(fn:(tx:SqliteExecutor)=>Promise<T>):Promise<T>;
}
export interface RecoveryCheckpoint { id:string; createdAt:string; ledger:LedgerData; draft:DraftSession|null; }
export interface StoredState {
  ledger:LedgerData;
  draft:DraftSession|null;
  lastApproval?:{id:string; records:LedgerData['expenses']};
  recovery?:{createdAt:string;ledger:LedgerData;draft:DraftSession|null}; // legacy
  recoveries?:RecoveryCheckpoint[];
}
export interface VersionedState { revision:number; state:StoredState; }
export interface SnapshotStore {
  initialize():Promise<void>;
  read():Promise<VersionedState>;
  readActive?():Promise<Pick<StoredState,'ledger'|'draft'>>;
  compareAndSwap(revision:number,state:StoredState):Promise<boolean>;
}

const VERSION=1;
const validId=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=4096&&!v.includes('\u0000');
const validTime=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const previewOk=(v:unknown)=>typeof v==='string'&&v.length<=20*1024*1024&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(v);
function validateDraftSession(value:unknown):asserts value is DraftSession|null {
  if(value===null)return;
  const invalid=()=>{throw new Error('پیش‌نویس ذخیره‌شده نامعتبر است.');};
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const d=value as DraftSession;
  if(!validId(d.id)||!Array.isArray(d.drafts)||!Array.isArray(d.previewPages)||d.previewPages.some(x=>!previewOk(x)))return invalid();
  const ids=new Set<string>();
  for(const item of d.drafts){
    if(!item||typeof item!=='object'||Array.isArray(item)||!validId(item.tempId)||ids.has(item.tempId)||typeof item.selected!=='boolean'||typeof item.title!=='string'||typeof item.vendor!=='string'||!Array.isArray(item.lineItems)||typeof item.amount!=='number'||!Number.isFinite(item.amount)||!['IRR','IRT','USD','EUR'].includes(item.currency)||!['image','pdf','text','text_file'].includes(item.sourceType)||(item.paymentTranches!==undefined&&!Array.isArray(item.paymentTranches))||(item.sourcePreviewUrl!==undefined&&!previewOk(item.sourcePreviewUrl)))return invalid();
    ids.add(item.tempId);attachmentIds([item]);
  }
}
function requireRecordIdentity(records:unknown[]){
  for(const item of records){
    const r=item as {id?:unknown;createdAt?:unknown;approvedAt?:unknown}|null;
    if(!r||!validId(r.id)||!validTime(r.createdAt)||!validTime(r.approvedAt))throw new Error('شناسه یا زمان ثبت سند ذخیره‌شده نامعتبر است؛ اطلاعات تغییر نکردند.');
  }
}
export function decodeStoredState(raw:string):StoredState {
  const state=JSON.parse(raw) as StoredState;
  if(!state||!state.ledger||!Array.isArray(state.ledger.expenses)||!Array.isArray(state.ledger.budgets)||!Array.isArray(state.ledger.categories)||!state.ledger.rates||!('draft' in state))throw new Error('پایگاه داده نامعتبر است؛ بازیابی لازم است.');
  requireRecordIdentity(state.ledger.expenses);
  const validated=parseAndValidateLedgerImport(state.ledger);
  validateDraftSession(state.draft);
  if(state.lastApproval){
    const approval=state.lastApproval;
    if(!validId(approval.id)||!Array.isArray(approval.records)||!approval.records.length||new Set(approval.records.map(r=>r?.id)).size!==approval.records.length)throw new Error('شناسه تأیید نامعتبر است.');
    requireRecordIdentity(approval.records);attachmentIds(approval.records);
  }
  if(state.recoveries!==undefined&&(!Array.isArray(state.recoveries)||state.recoveries.length>3))throw new Error('آرشیو بازیابی نامعتبر است.');
  const recoveries=state.recoveries??(state.recovery?[{...state.recovery,id:'legacy-'+state.recovery.createdAt}]:[]);
  const ids=new Set<string>();
  for(const r of recoveries){
    if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||!r.ledger||!('draft' in r))throw new Error('پشتیبان داخلی نامعتبر است.');
    ids.add(r.id);decodeStoredState(JSON.stringify({ledger:r.ledger,draft:r.draft}));
  }
  delete state.recovery;
  state.recoveries=recoveries;
  return {...state,ledger:{...state.ledger,...validated,aiConfig:sanitizeAiConfig(state.ledger.aiConfig)}};
}

// Phase-2 transitional schema: one versioned snapshot per ledger. CAS is a single
// SQL update, so ledger + draft + approval token commit together. No localStorage fallback.
export class SqliteSnapshotStore implements SnapshotStore {
  constructor(private readonly db:SqliteDriver){}
  async initialize(){
    await this.db.transaction(async tx=>{
      const rows=await tx.query<{user_version:number}>('PRAGMA user_version');
      const version=rows[0]?.user_version;
      if(version===0){
        await tx.run('CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT NOT NULL)');
        await tx.run('INSERT INTO ledger_state (id, revision, payload) VALUES (1, 0, ?)',[JSON.stringify({ledger:emptyLedger(),draft:null})]);
        await tx.run('PRAGMA user_version = 1');
      }else if(version!==VERSION)throw new Error('نسخه پایگاه داده پشتیبانی نمی‌شود؛ داده‌ها تغییر نکردند.');
      const row=await tx.query<{revision:number;payload:string}>('SELECT revision,payload FROM ledger_state WHERE id=1');
      if(row.length!==1)throw new Error('رکورد اصلی پایگاه داده پیدا نشد؛ بازیابی لازم است.');
      decodeStoredState(row[0].payload);
    });
  }
  async read(){
    const rows=await this.db.query<{revision:number;payload:string}>('SELECT revision,payload FROM ledger_state WHERE id=1');
    if(rows.length!==1||!Number.isSafeInteger(rows[0].revision))throw new Error('رکورد دفتر معتبر نیست.');
    return {revision:rows[0].revision,state:decodeStoredState(rows[0].payload)};
  }
  async compareAndSwap(revision:number,state:StoredState){
    const payload=JSON.stringify(state);
    decodeStoredState(payload);
    const result=await this.db.run('UPDATE ledger_state SET revision=revision+1,payload=? WHERE id=1 AND revision=?',[payload,revision]);
    return result.changes===1;
  }
}
