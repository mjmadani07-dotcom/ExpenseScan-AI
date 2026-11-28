import { assembleLedger,canonicalJson,diffLedgerRows,partitionLedger,type LedgerRow } from './ledgerRows';
import { type AttachmentStore,type AttachmentCleanupResult,attachFile,decodeBytes,verifyAttachment } from './attachments';
import { toEnglishDigits } from '../utils/jalali';
import { emptyLedger } from './ledgerDomain';
import { migrateSingleLedger,validateMultiLedger,type MultiLedgerState,type MultiLedgerStore,type LedgerProfile } from './multiLedger';
import { decodeStoredState, type SnapshotStore, type StoredState } from './sqliteStore';

interface NativeLedgerBridge {
  initialize(options:{initialPayload:string}):Promise<void>;
  read(options?:{scope:'all'|'active'}):Promise<{revision:number;schema:number;scope?:'all'|'active';payload?:string;rows?:string}>;
  commitRows(options:{revision:string;patch:string;migration:boolean}):Promise<{committed:boolean}>;
  multiSchema():Promise<{schema:number}>;
  migrateMulti(options:{revision:string;profile:string}):Promise<void>;
  readMulti():Promise<{schema:number;revision:number;workspaces:string}>;
  commitMulti(options:{revision:string;workspaces:string}):Promise<{committed:boolean}>;
  restoreMulti(options:{revision:string;workspaces:string;confirmed:true}):Promise<{committed:boolean}>;
  minimize():Promise<void>;
  sessionStatus():Promise<{unlocked:boolean;deviceSecure:boolean;biometricAvailable?:boolean}>;
  unlockBiometric():Promise<void>;
  unlockApp():Promise<void>;
  lockApp():Promise<void>;
  noteActivity():Promise<void>;
  saveExportFile(options:{name:string;data:string;mime:string}):Promise<void>;
  renderReportPdf(options:{report:string}):Promise<{data:string}>;
  saveReportPdf(options:{report:string;name:string}):Promise<{legacy:boolean}>;
  putAttachment(options:{id:string;data:string}):Promise<void>;
  readAttachment(options:{id:string}):Promise<{data:string}>;
  attachmentInventory():Promise<{items:string}>;
  cleanupAttachments(options:{revision:string}):Promise<AttachmentCleanupResult>;
  loadKeys():Promise<{keys:string}>;
  saveKey(options:{provider:string;value:string}):Promise<{keys:string}>;
  saveBackupFile(options:{name:string;data:string}):Promise<void>;
  beginStreamBackup():Promise<{token:string}>;
  appendStreamBackup(options:{token:string;data:string}):Promise<void>;
  finishStreamBackup(options:{token:string;name:string}):Promise<void>;
  discardStreamBackup(options:{token:string}):Promise<void>;
}
type Runtime = {getPlatform?:()=>string;isNativePlatform?:()=>boolean;Plugins?:{LedgerStorage?:NativeLedgerBridge}};
function runtime():Runtime|undefined {
  return (globalThis as typeof globalThis & {Capacitor?:Runtime}).Capacitor;
}
export function isAndroidRuntime(){return runtime()?.getPlatform?.()==='android';}
function bridge():NativeLedgerBridge {
  const b=runtime()?.Plugins?.LedgerStorage;
  if(!b)throw new Error('اتصال به پایگاه داده اندروید برقرار نشد؛ داده‌ها تغییر نکردند.');
  return b;
}
export async function minimizeAndroid(){await bridge().minimize();}
export class AndroidSnapshotStore implements SnapshotStore {
  private baseline:{revision:number;rows:LedgerRow[]}|null=null;
  async initialize(){
    await bridge().initialize({initialPayload:JSON.stringify({ledger:emptyLedger(),draft:null})});
    const row=await bridge().read({scope:'active'});
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('نسخه دفتر معتبر نیست.');
    if(row.schema===2){
      if(typeof row.payload!=='string')throw new Error('دفتر قبلی قابل خواندن نیست.');
      const old=decodeStoredState(row.payload),rows=partitionLedger(old);
      if(canonicalJson(assembleLedger(rows))!==canonicalJson(old))throw new Error('مهاجرت دفتر بدون تغییر داده‌ها تأیید نشد.');
      const result=await bridge().commitRows({revision:String(row.revision),migration:true,patch:JSON.stringify(diffLedgerRows([],rows))});
      if(!result.committed)throw new Error('دفتر هم‌زمان تغییر کرد؛ مهاجرت را دوباره انجام دهید.');
      await this.read(); // verify the complete migrated state before returning
    }else if(row.schema===3){this.decodeActive(row);}
    else throw new Error('نسخه پایگاه داده پشتیبانی نمی‌شود.');
  }
  private decodeActive(row:Awaited<ReturnType<NativeLedgerBridge['read']>>){
    if(!Number.isSafeInteger(row.revision)||row.revision<0||row.schema!==3||row.scope!=='active'||typeof row.rows!=='string')throw new Error('نمای فعال دفتر نامعتبر است.');
    const {ledger,draft}=assembleLedger(JSON.parse(row.rows),'active');
    return {ledger,draft}; // never seed the full-write baseline with a partial read
  }
  async readActive(){return this.decodeActive(await bridge().read({scope:'active'}));}
  async read(){
    const row=await bridge().read({scope:'all'});
    if(!Number.isSafeInteger(row.revision)||row.revision<0||row.schema!==3||row.scope!=='all'||typeof row.rows!=='string')throw new Error('نسخه دفتر معتبر نیست.');
    const rows=JSON.parse(row.rows) as LedgerRow[];
    const state=assembleLedger(rows);
    this.baseline={revision:row.revision,rows};
    return {revision:row.revision,state};
  }
  async compareAndSwap(revision:number,state:StoredState){
    if(this.baseline?.revision!==revision)return false;
    const rows=partitionLedger(state);
    const patch=diffLedgerRows(this.baseline.rows,rows);
    this.baseline=null;
    const result=await bridge().commitRows({revision:String(revision),patch:JSON.stringify(patch),migration:false});
    if(result.committed)this.baseline={revision:revision+1,rows};
    return result.committed===true;
  }
}

export async function nativeLoadKeys(){return JSON.parse((await bridge().loadKeys()).keys);}
export async function nativeSaveKey(provider:string,value:string){return JSON.parse((await bridge().saveKey({provider,value})).keys);}
export async function nativeSaveBackup(name:string,data:string){await bridge().saveBackupFile({name,data});}

export const nativeSessionStatus=()=>bridge().sessionStatus();
export const nativeUnlock=(biometric=false)=>biometric?bridge().unlockBiometric():bridge().unlockApp();
export const nativeLock=()=>bridge().lockApp();
export const nativeActivity=()=>bridge().noteActivity();
export async function nativeExportFile(name:string,data:Uint8Array,mime:string){
 let raw='';for(let i=0;i<data.length;i+=16384)raw+=String.fromCharCode(...data.subarray(i,i+16384));
 await bridge().saveExportFile({name:toEnglishDigits(name),data:btoa(raw),mime});
}

export const androidAttachments:AttachmentStore={
 async cleanup(revision){if(!Number.isSafeInteger(revision)||revision<0)throw new Error('نسخه دفتر نامعتبر است.');return bridge().cleanupAttachments({revision:String(revision)});},
 async inventory(){return JSON.parse((await bridge().attachmentInventory()).items);},
 async put(id,data){await verifyAttachment(id,data);await bridge().putAttachment({id,data});},
 async get(id){const result=await bridge().readAttachment({id});await verifyAttachment(id,result.data);return result.data;}
};
export const nativeAttachFile=(file:File,kind:'image'|'pdf'|'text_file')=>attachFile(androidAttachments,file,kind);
export async function nativeExportAttachment(id:string,mime:string){const data=decodeBytes(await androidAttachments.get(id));const ext:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','text/plain':'txt','text/csv':'csv'};if(!ext[mime])throw new Error('نوع پیوست نامعتبر است.');await nativeExportFile('attachment-'+id.slice(0,12)+'.'+ext[mime],data,mime);}

export async function nativeWriteStreamBackup(name:string,produce:(sink:import('./streamBackup').ByteSink)=>Promise<number>,signal?:AbortSignal){
 const b=bridge();const {token}=await b.beginStreamBackup();
 try{
  await produce(async bytes=>{
    // Bridge only handles 1 MiB of encrypted bytes per call.
    for(let i=0;i<bytes.length;i+=1048576){if(signal?.aborted)throw new Error('عملیات پشتیبان‌گیری لغو شد.');let raw='';const chunk=bytes.subarray(i,i+1048576);for(let j=0;j<chunk.length;j+=16384)raw+=String.fromCharCode(...chunk.subarray(j,j+16384));await b.appendStreamBackup({token,data:btoa(raw)});}
  });
  if(signal?.aborted)throw new Error('عملیات پشتیبان‌گیری لغو شد.');
  await b.finishStreamBackup({token,name:toEnglishDigits(name)});
 }finally{await b.discardStreamBackup({token}).catch(()=>{});}
}

export async function nativeSaveReportPdf(name:string,report:unknown){const b=bridge(),filename=toEnglishDigits(name),payload=JSON.stringify(report);const result=await b.saveReportPdf({name:filename,report:payload});if(result.legacy){const {data}=await b.renderReportPdf({report:payload});await b.saveExportFile({name:filename,data,mime:'application/pdf'});}return result.legacy?'فایل PDF در مسیر انتخابی ذخیره شد.':'فایل PDF در Downloads/HesabYar ذخیره شد.';}

// Opt-in adapter, deliberately not activated by AndroidAuthGate until all-ledger
// portable backup and UI switching are ready. Never auto-migrate current users.
export const nativeLedgerSchema=async()=>(await bridge().multiSchema()).schema;
export class AndroidMultiLedgerStore implements MultiLedgerStore {
 private initialized=false;
 async initialize(){
   const schema=(await bridge().multiSchema()).schema;
   if(schema!==4){
     const legacy=new AndroidSnapshotStore();await legacy.initialize();const {revision,state}=await legacy.read();
     const expected=migrateSingleLedger(state,new Date().toISOString());
     await bridge().migrateMulti({revision:String(revision),profile:JSON.stringify(expected.workspaces[0].profile)});
     const actual=await this.read();
     if(actual.revision!==revision+1||canonicalJson(actual.state)!==canonicalJson(expected))throw new Error('تطبیق اطلاعات پس از مهاجرت ناموفق بود.');
   }else await this.read();
   this.initialized=true;
 }
 async read(){
   const raw=await bridge().readMulti();
   if(raw.schema!==4||!Number.isSafeInteger(raw.revision)||raw.revision<0||typeof raw.workspaces!=='string')throw new Error('نسخه دفاتر نامعتبر است.');
   const rows=JSON.parse(raw.workspaces) as {profile:LedgerProfile;rows:LedgerRow[]}[];
   if(!Array.isArray(rows))throw new Error('ساختار دفاتر نامعتبر است.');
   return {revision:raw.revision,state:validateMultiLedger({version:1,workspaces:rows.map(w=>({profile:w.profile,state:assembleLedger(w.rows)}))})};
 }
 async compareAndSwap(revision:number,state:MultiLedgerState){
   if(!this.initialized||!Number.isSafeInteger(revision)||revision<0)throw new Error('دفاتر هنوز آماده نیستند.');
   const checked=validateMultiLedger(state);
   const workspaces=checked.workspaces.map(w=>({profile:w.profile,rows:partitionLedger(w.state)}));
   return (await bridge().commitMulti({revision:String(revision),workspaces:JSON.stringify(workspaces)})).committed===true;
 }
 async restoreAll(revision:number,state:MultiLedgerState){
   if(!this.initialized||!Number.isSafeInteger(revision)||revision<0)throw new Error('دفاتر هنوز آماده نیستند.');
   const checked=validateMultiLedger(state);
   const workspaces=checked.workspaces.map(w=>({profile:w.profile,rows:partitionLedger(w.state)}));
   return (await bridge().restoreMulti({revision:String(revision),workspaces:JSON.stringify(workspaces),confirmed:true})).committed===true;
 }
}
