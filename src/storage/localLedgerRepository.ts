import { writeStreamBackup,readStreamBackup,type ByteSink,type Progress } from './streamBackup';
import { attachmentIds,snapshotAttachmentIds,verifyAttachment,auditAttachmentInventory,type AttachmentStore } from './attachments';
import { cleanBackup, type BackupSnapshot } from './portableBackup';
import type { AiConfig,CategoryBudget,ExchangeRates,ExpenseFields,ExpenseRecord,JsonImportMode } from '../types/expense';
import { LedgerDomain } from './ledgerDomain';
import type { DraftSession,LedgerRepository } from './ledgerRepository';
import type { SnapshotStore,StoredState } from './sqliteStore';

export class LocalLedgerRepository implements LedgerRepository {
  readonly mode='local' as const;
  private queue:Promise<unknown>=Promise.resolve();
  private disposed=false;
  private pending=0;
  get hasPendingWork(){return this.pending>0;}
  closeIfIdle(){if(this.hasPendingWork)return false;this.dispose();return true;}
  private track<T>(task:Promise<T>):Promise<T>{this.pending++;const tracked=task.finally(()=>{this.pending--;});this.queue=tracked;return tracked;}
  dispose(){this.disposed=true;}
  private assertOpen(){if(this.disposed)throw new Error('نشست دفتر پایان یافته است؛ دوباره وارد شوید.');}
  constructor(private readonly store:SnapshotStore,private readonly attachments?:AttachmentStore){}
  private async ensureAttachments(ids:string[]){if(ids.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const id of ids){this.assertOpen();await verifyAttachment(id,await this.attachments!.get(id));this.assertOpen();}}
  initialize(){return this.store.initialize();}
  private async active(){this.assertOpen();const result=this.store.readActive?await this.store.readActive():(await this.store.read()).state;this.assertOpen();return result;}
  async loadActive(){await this.queue.catch(()=>{});const {ledger,draft}=await this.active();return {ledger,draft};}
  async load(){return (await this.loadActive()).ledger;}
  async aiStatus(){return null;}
  async loadDraft(){return (await this.loadActive()).draft;}
  private change<T>(fn:(domain:LedgerDomain,state:StoredState)=>T|Promise<T>):Promise<T>{
    const task=this.queue.catch(()=>{}).then(async()=>{
      this.assertOpen();
      const {revision,state}=await this.store.read();this.assertOpen();
      const domain=new LedgerDomain(state.ledger);
      const result=await fn(domain,state);
      state.ledger=domain.ledger;
      this.assertOpen();
      if(!await this.store.compareAndSwap(revision,state))throw new Error('دفتر هم‌زمان تغییر کرده است؛ دوباره بارگذاری کنید.');
      return result;
    });
    return this.track(task);
  }
  saveDraft(draft:DraftSession|null){return this.change(async(_d,s)=>{if(draft){const existing=new Set(attachmentIds(s.draft?.drafts??[]));await this.ensureAttachments(attachmentIds(draft.drafts).filter(id=>!existing.has(id)));}if(draft&&s.lastApproval?.id===draft.id)throw new Error('این پیش‌نویس قبلاً ثبت شده است. دفتر را دوباره بارگذاری کنید.');s.draft=draft?structuredClone(draft):null;});}
  add(items:ExpenseFields[],draftId?:string){
    return this.change(async(d,s)=>{
      if(draftId&&s.lastApproval?.id===draftId){
        // A lost response must not recreate or return stale/deleted documents.
        const previous=s.lastApproval.records;
        if(!previous.length||previous.length!==items.length)throw new Error('این پیش‌نویس قبلاً ثبت شده است؛ تعداد اسناد متفاوت است. دفتر را دوباره بارگذاری کنید.');
        const current=new Map(d.ledger.expenses.map(x=>[x.id,x]));
        const records=previous.map(old=>{
          const live=current.get(old.id);
          if(!live||live.createdAt!==old.createdAt||live.approvedAt!==old.approvedAt)throw new Error('این پیش‌نویس قبلاً ثبت شده و بعضی اسناد تغییر هویت داده یا حذف شده‌اند. دفتر را دوباره بارگذاری کنید.');
          return live;
        });
        return records;
      }
      if(draftId&&s.draft?.id!==draftId)throw new Error('پیش‌نویس تغییر کرده یا موجود نیست.');
      if(!items.length)throw new Error('سند انتخاب نشده است.');
      await this.ensureAttachments(attachmentIds(items));
      const created=d.addExpensesBatch(items);
      if(draftId){s.draft=null;s.lastApproval={id:draftId,records:created};}
      return created;
    });
  }
  update(id:string,patch:Partial<ExpenseFields>){return this.change(async(d,s)=>{const before=d.ledger.expenses.find(x=>x.id===id);const record=d.updateExpense(id,patch);if(!record)throw new Error('سند یافت نشد.');if(record.attachmentId!==before?.attachmentId){await this.ensureAttachments(attachmentIds([record]));this.checkpoint(s);}return record;});}
  remove(id:string){return this.change((d,s)=>{this.checkpoint(s);if(!d.deleteExpense(id))throw new Error('سند یافت نشد.');});}
  settings(budgets:CategoryBudget[],rates:ExchangeRates,aiConfig:AiConfig){return this.change(d=>d.updateSettings({budgets,rates,aiConfig}));}
  import(data:unknown,mode:JsonImportMode){return this.change(async(d,s)=>{this.checkpoint(s);const result=d.importLedgerOnServer(data,mode);await this.ensureAttachments(attachmentIds(d.ledger.expenses));return result;});}
  clear(scope:'samples'|'all'){return this.change((d,s)=>{this.checkpoint(s);return d.clearExpensesOnServer(scope);});}
  addCategory(input:Parameters<LedgerDomain['addCategoryOnServer']>[0]){return this.change(d=>d.addCategoryOnServer(input));}
  updateCategory(id:string,patch:Parameters<LedgerDomain['updateCategoryOnServer']>[1]){return this.change(d=>{const result=d.updateCategoryOnServer(id,patch);if(!result)throw new Error('دسته‌بندی یافت نشد.');return result;});}
  deleteCategory(id:string,reassignToId?:string){return this.change((d,s)=>{this.checkpoint(s);return d.deleteCategoryOnServer(id,reassignToId);});}
  private checkpoint(s:StoredState){
    const next={id:globalThis.crypto.randomUUID(),createdAt:new Date().toISOString(),ledger:structuredClone(s.ledger),draft:structuredClone(s.draft)};
    s.recoveries=[next,...(s.recoveries??[])].slice(0,3);
    delete s.recovery;
  }
  exportStreamBackup(password:string,sink:ByteSink,progress?:Progress,signal?:AbortSignal){
    const task=this.queue.catch(()=>{}).then(async()=>{const s=await this.active();return writeStreamBackup({ledger:s.ledger,draft:s.draft},password,this.attachments,async bytes=>{this.assertOpen();await sink(bytes);this.assertOpen();},progress,signal);});
    return this.track(task);
  }
  restoreStreamBackup(file:Blob,password:string,progress?:Progress,signal?:AbortSignal){
    return this.change(async(d,s)=>{
      const files=this.attachments?{put:async(id:string,data:string)=>{this.assertOpen();await this.attachments!.put(id,data);this.assertOpen();}}:undefined;
      const clean=await readStreamBackup(file,password,files,progress,signal);
      if(signal?.aborted)throw new Error('بازیابی لغو شد.');
      this.checkpoint(s);d.ledger={...clean.ledger,aiConfig:d.ledger.aiConfig};s.draft=clean.draft;s.lastApproval=undefined;
    });
  }
  async exportBackup(){await this.queue.catch(()=>{});const s=await this.active();const ids=snapshotAttachmentIds(s.ledger,s.draft);const attachments:Record<string,string>={};let total=0;if(ids.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const id of ids){const data=await this.attachments!.get(id);await verifyAttachment(id,data);total+=data.length;if(total>28*1024*1024)throw new Error('مجموع پیوست‌ها از ظرفیت فعلی فایل پشتیبان بیشتر است؛ هیچ فایل ناقصی ایجاد نشد.');attachments[id]=data;}return cleanBackup({ledger:s.ledger,draft:s.draft,attachments});}
  cleanupAttachments(){
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(!this.attachments?.cleanup)throw new Error('پاک‌سازی در این دستگاه در دسترس نیست.');
      this.assertOpen();const {revision}=await this.store.read();this.assertOpen();return this.attachments.cleanup(revision);
    });return this.track(task);
  }
  async attachmentAudit(){await this.queue.catch(()=>{});this.assertOpen();if(!this.attachments?.inventory)throw new Error('فهرست فایل‌های اصلی در دسترس نیست.');const s=(await this.store.read()).state;return auditAttachmentInventory(await this.attachments.inventory(),s);}
  async recoveryList(){await this.queue.catch(()=>{});this.assertOpen();return ((await this.store.read()).state.recoveries??[]).map(r=>({id:r.id,createdAt:r.createdAt,count:r.ledger.expenses.length}));}
  async recoveryInfo(){return (await this.recoveryList())[0]??null;}
  createRecovery(){return this.change((_d,s)=>{this.checkpoint(s);});}
  deleteRecovery(id:string){return this.change((_d,s)=>{if(!s.recoveries?.some(r=>r.id===id))throw new Error('نسخه بازیابی یافت نشد.');s.recoveries=s.recoveries.filter(r=>r.id!==id);});}
  restoreBackup(snapshot:BackupSnapshot){const clean=cleanBackup(snapshot);return this.change(async(d,s)=>{const entries=Object.entries(clean.attachments??{});if(entries.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const [id,data] of entries)await verifyAttachment(id,data);for(const [id,data] of entries){this.assertOpen();await this.attachments!.put(id,data);}this.checkpoint(s);d.ledger={...clean.ledger,aiConfig:d.ledger.aiConfig};s.draft=clean.draft;s.lastApproval=undefined;});}
  restoreRecovery(id?:string){return this.change(async(d,s)=>{const r=id?s.recoveries?.find(x=>x.id===id):s.recoveries?.[0];if(!r)throw new Error('نسخه بازیابی موجود نیست.');await this.ensureAttachments(snapshotAttachmentIds(r.ledger,r.draft));this.checkpoint(s);d.ledger={...r.ledger,aiConfig:d.ledger.aiConfig};s.draft=r.draft;s.lastApproval=undefined;});}
}
