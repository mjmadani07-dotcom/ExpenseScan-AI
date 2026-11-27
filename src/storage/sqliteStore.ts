import type { LedgerData } from '../types/expense';
import { emptyLedger, sanitizeAiConfig } from './ledgerDomain';
import { parseAndValidateLedgerImport } from '../utils/finance';
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
export function decodeStoredState(raw:string):StoredState {
  const state=JSON.parse(raw) as StoredState;
  if(!state||!state.ledger||!Array.isArray(state.ledger.expenses)||!Array.isArray(state.ledger.budgets)||!Array.isArray(state.ledger.categories)||!state.ledger.rates||!('draft' in state))throw new Error('پایگاه داده نامعتبر است؛ بازیابی لازم است.');
  const validated=parseAndValidateLedgerImport(state.ledger);
  if(state.draft!==null&&(!state.draft||typeof state.draft.id!=='string'||!Array.isArray(state.draft.drafts)||!Array.isArray(state.draft.previewPages)))throw new Error('پیش‌نویس ذخیره‌شده نامعتبر است.');
  if(state.lastApproval&&(!state.lastApproval.id||!Array.isArray(state.lastApproval.records)))throw new Error('شناسه تأیید نامعتبر است.');
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
