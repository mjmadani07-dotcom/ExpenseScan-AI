import { LocalLedgerRepository } from './localLedgerRepository';
import { ScopedLedgerStore,changeCatalog,createLedger,editLedgerProfile,validateMultiLedger,type MultiLedgerStore,type LedgerProfile,type MultiLedgerState } from './multiLedger';
import { canonicalJson } from './ledgerRows';
import {makeConsolidatedReport,type ReportSelection,type ConsolidatedReport} from '../utils/consolidatedReport';
import type { AttachmentStore } from './attachments';
import type { DraftSession } from './ledgerRepository';
import {writeMultiLedgerBackup,readMultiLedgerBackup,previewMultiLedgerBackup,isMultiLedgerBackup} from './multiLedgerBackup';
import {isStreamBackup,previewStreamBackup,readStreamBackup,type ByteSink,type Progress,type BackupManifest} from './streamBackup';
import {decryptBackup,cleanBackupManifest} from './portableBackup';

export interface LedgerCatalogItem { profile:LedgerProfile; count:number; hasDraft:boolean; }
export interface OpenWorkspace { profile:LedgerProfile; repository:LocalLedgerRepository; }
export function describeCatalog(root:MultiLedgerState):LedgerCatalogItem[]{
 return validateMultiLedger(root).workspaces.map(w=>({profile:w.profile,count:w.state.ledger.expenses.length,hasDraft:w.state.draft!==null}));
}
// Only one write-capable workspace session exists. Catalog edits take place
// outside App, after the previous repository is drained and disposed.
export class MultiLedgerSession {
 private active:OpenWorkspace|null=null;
 private disposed=false;
 private operating=false;
 constructor(private readonly store:MultiLedgerStore,private readonly attachments?:AttachmentStore){}
 private assertOpen(){if(this.disposed)throw new Error('نشست دفاتر پایان یافته است.');}
 private async exclusive<T>(fn:()=>Promise<T>):Promise<T>{
  this.assertOpen();if(this.operating)throw new Error('عملیات دیگری در حال انجام است.');
  this.operating=true;
  try{const result=await fn();this.assertOpen();return result;}finally{this.operating=false;}
 }
 private assertCatalog(){this.assertOpen();if(this.active)throw new Error('ابتدا از دفتر فعال خارج شوید.');}
 async report(selection:ReportSelection){return this.exclusive(async()=>{this.assertCatalog();return makeConsolidatedReport((await this.store.read()).state,selection);});}
 async exportReport<T>(report:ConsolidatedReport,write:(snapshot:ConsolidatedReport)=>Promise<T>){return this.exclusive(async()=>{this.assertCatalog();return write(structuredClone(report));});}
 async writeBackup(password:string,sink:ByteSink,progress?:Progress,signal?:AbortSignal){
  return this.exclusive(async()=>{this.assertCatalog();return writeMultiLedgerBackup((await this.store.read()).state,password,this.attachments,sink,progress,signal);});
 }
 async previewBackup(file:Blob,password:string,signal?:AbortSignal){
  return this.exclusive(async()=>{
   this.assertCatalog();
   if(!await isMultiLedgerBackup(file))throw new Error('برای جایگزینی همه دفاتر فقط فایل پشتیبان چنددفتره مجاز است؛ پشتیبان تک‌دفتره باید جداگانه وارد شود.');
   const preview=await previewMultiLedgerBackup(file,password,signal);
   return {...preview,revision:(await this.store.read()).revision};
  });
 }
 // Confirmation UI must show preview and require a separately published safety backup.
 // The callback must resolve only after verified durable publication.
 async restoreBackup(file:Blob,password:string,preview:Awaited<ReturnType<MultiLedgerSession['previewBackup']>>,saveSafetyBackup:(write:(sink:ByteSink)=>Promise<number>)=>Promise<void>,safetyPassword:string,progress?:Progress,signal?:AbortSignal){
  return this.exclusive(async()=>{
   this.assertCatalog();if(!this.store.restoreAll)throw new Error('بازیابی کامل در این محیط پشتیبانی نمی‌شود.');
   const before=await this.store.read();
   if(before.revision!==preview.revision)throw new Error('دفاتر تغییر کرده‌اند؛ پیش‌نمایش را دوباره انجام دهید.');
   const restored=await readMultiLedgerBackup(file,password,this.attachments,progress,signal);
   if(canonicalJson(restored)!==canonicalJson(preview.manifest))throw new Error('فایل با پیش‌نمایش تأییدشده یکسان نیست.');
   this.assertOpen();if(signal?.aborted)throw new Error('بازیابی لغو شد.');
   await saveSafetyBackup(sink=>writeMultiLedgerBackup(before.state,safetyPassword,this.attachments,sink,undefined,signal));
   this.assertOpen();if(signal?.aborted)throw new Error('بازیابی لغو شد.');
   if(!await this.store.restoreAll(before.revision,restored))throw new Error('دفاتر هم‌زمان تغییر کردند؛ بازیابی انجام نشد.');
   return describeCatalog(restored);
  });
 }
 async previewLegacyBackup(file:Blob,password:string,signal?:AbortSignal){
  return this.exclusive(async()=>{
   this.assertCatalog();if(await isMultiLedgerBackup(file))throw new Error('این فایل چنددفتره است.');
   const before=await this.store.read();
   if(await isStreamBackup(file)){const p=await previewStreamBackup(file,password,signal);return {...p,revision:before.revision};}
   if(file.size>64*1024*1024)throw new Error('حجم فایل قدیمی بیش از حد مجاز است.');
   const decoded=await decryptBackup(await file.text(),password);
   return {manifest:cleanBackupManifest(decoded),attachmentCount:Object.keys(decoded.attachments??{}).length,revision:before.revision};
  });
 }
 async importLegacyBackup(file:Blob,password:string,preview:Awaited<ReturnType<MultiLedgerSession['previewLegacyBackup']>>,name:string,progress?:Progress,signal?:AbortSignal){
  return this.exclusive(async()=>{
   this.assertCatalog();const before=await this.store.read();
   if(before.revision!==preview.revision)throw new Error('دفاتر تغییر کرده‌اند؛ پیش‌نمایش را دوباره انجام دهید.');
   const id=crypto.randomUUID(),next=createLedger(before.state,name,'#0f766e',new Date().toISOString(),id);
   const stage=this.attachments;
   let manifest:BackupManifest;
   if(await isStreamBackup(file))manifest=await readStreamBackup(file,password,stage,progress,signal);
   else{
    if(await isMultiLedgerBackup(file)||file.size>64*1024*1024)throw new Error('فایل تک‌دفتره نامعتبر است.');
    const decoded=await decryptBackup(await file.text(),password);
    manifest=cleanBackupManifest(decoded);
    const entries=Object.entries(decoded.attachments??{});
    if(entries.length&&!stage)throw new Error('محل نگهداری پیوست در دسترس نیست.');
    for(let i=0;i<entries.length;i++){this.assertOpen();if(signal?.aborted)throw new Error('ورود پشتیبان لغو شد.');await stage!.put(...entries[i]);progress?.({done:i+1,total:entries.length});}
   }
   if(canonicalJson(manifest)!==canonicalJson(preview.manifest))throw new Error('فایل با پیش‌نمایش یکسان نیست.');
   this.assertOpen();if(signal?.aborted)throw new Error('ورود پشتیبان لغو شد.');
   next.workspaces.find(w=>w.profile.id===id)!.state={...manifest,recoveries:[]};
   const checked=validateMultiLedger(next);
   if(!await this.store.compareAndSwap(before.revision,checked))throw new Error('دفاتر هم‌زمان تغییر کردند؛ ورود انجام نشد.');
   return describeCatalog(checked);
  });
 }
 async catalog(){return this.exclusive(async()=>{this.assertCatalog();return describeCatalog((await this.store.read()).state);});}
 async create(name:string,color:string){return this.exclusive(async()=>{this.assertCatalog();return describeCatalog(await changeCatalog(this.store,s=>createLedger(s,name,color)));});}
 async edit(id:string,patch:Partial<Pick<LedgerProfile,'name'|'color'|'archived'>>){return this.exclusive(async()=>{this.assertCatalog();return describeCatalog(await changeCatalog(this.store,s=>editLedgerProfile(s,id,patch)));});}
 async open(id:string){return this.exclusive(async()=>{
  this.assertCatalog();
  const w=validateMultiLedger((await this.store.read()).state).workspaces.find(x=>x.profile.id===id);
  if(!w||w.profile.archived)throw new Error('این دفتر فعال نیست.');
  // Global GC/audit and all-ledger portable backup UI are gated separately.
  const files=this.attachments?{get:(id:string)=>this.attachments!.get(id),put:(id:string,data:string)=>this.attachments!.put(id,data)}:undefined;
  const repository=new LocalLedgerRepository(new ScopedLedgerStore(this.store,id),files);
  try{await repository.loadActive();this.assertOpen();this.active={profile:w.profile,repository};return this.active;}
  catch(e){repository.dispose();throw e;}
 });}
 async close(expectedDraft:DraftSession|null){return this.exclusive(async()=>{
  const current=this.active;if(!current)throw new Error('دفتر فعالی وجود ندارد.');
  if(current.repository.hasPendingWork)throw new Error('ابتدا منتظر پایان ذخیره‌سازی دفتر بمانید.');
  const saved=await current.repository.loadDraft();this.assertOpen();
  if(canonicalJson(saved)!==canonicalJson(expectedDraft))throw new Error('پیش‌نویس روی صفحه با نسخه ذخیره‌شده یکسان نیست؛ ابتدا ذخیره یا بازیابی آن را بررسی کنید.');
  if(!current.repository.closeIfIdle())throw new Error('عملیات ذخیره‌سازی دیگری آغاز شده است.');
  this.active=null;
 });}
 dispose(){this.disposed=true;this.active?.repository.dispose();this.active=null;}
}
