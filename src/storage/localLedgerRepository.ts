import { attachmentIds,snapshotAttachmentIds,verifyAttachment,type AttachmentStore } from './attachments';
import { cleanBackup, type BackupSnapshot } from './portableBackup';
import type { AiConfig,CategoryBudget,ExchangeRates,ExpenseFields,ExpenseRecord,JsonImportMode } from '../types/expense';
import { LedgerDomain } from './ledgerDomain';
import type { DraftSession,LedgerRepository } from './ledgerRepository';
import type { SnapshotStore,StoredState } from './sqliteStore';

export class LocalLedgerRepository implements LedgerRepository {
  readonly mode='local' as const;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private readonly store:SnapshotStore,private readonly attachments?:AttachmentStore){}
  private async ensureAttachments(ids:string[]){if(ids.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const id of ids)await verifyAttachment(id,await this.attachments!.get(id));}
  initialize(){return this.store.initialize();}
  async load(){await this.queue.catch(()=>{});return (await this.store.read()).state.ledger;}
  async aiStatus(){return null;}
  async loadDraft(){await this.queue.catch(()=>{});return (await this.store.read()).state.draft;}
  private change<T>(fn:(domain:LedgerDomain,state:StoredState)=>T|Promise<T>):Promise<T>{
    const task=this.queue.catch(()=>{}).then(async()=>{
      const {revision,state}=await this.store.read();
      const domain=new LedgerDomain(state.ledger);
      const result=await fn(domain,state);
      state.ledger=domain.ledger;
      if(!await this.store.compareAndSwap(revision,state))throw new Error('دفتر هم‌زمان تغییر کرده است؛ دوباره بارگذاری کنید.');
      return result;
    });
    this.queue=task;
    return task;
  }
  saveDraft(draft:DraftSession|null){return this.change(async(_d,s)=>{if(draft){const existing=new Set(attachmentIds(s.draft?.drafts??[]));await this.ensureAttachments(attachmentIds(draft.drafts).filter(id=>!existing.has(id)));}if(draft&&s.lastApproval?.id===draft.id)throw new Error('این پیش‌نویس قبلاً ثبت شده است. دفتر را دوباره بارگذاری کنید.');s.draft=draft?structuredClone(draft):null;});}
  add(items:ExpenseFields[],draftId?:string){
    return this.change(async(d,s)=>{
      if(draftId&&s.lastApproval?.id===draftId)return s.lastApproval.records;
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
  async exportBackup(){await this.queue.catch(()=>{});const s=(await this.store.read()).state;const ids=snapshotAttachmentIds(s.ledger,s.draft);const attachments:Record<string,string>={};let total=0;if(ids.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const id of ids){const data=await this.attachments!.get(id);await verifyAttachment(id,data);total+=data.length;if(total>28*1024*1024)throw new Error('مجموع پیوست‌ها از ظرفیت فعلی فایل پشتیبان بیشتر است؛ هیچ فایل ناقصی ایجاد نشد.');attachments[id]=data;}return cleanBackup({ledger:s.ledger,draft:s.draft,attachments});}
  async recoveryList(){await this.queue.catch(()=>{});return ((await this.store.read()).state.recoveries??[]).map(r=>({id:r.id,createdAt:r.createdAt,count:r.ledger.expenses.length}));}
  async recoveryInfo(){return (await this.recoveryList())[0]??null;}
  createRecovery(){return this.change((_d,s)=>{this.checkpoint(s);});}
  deleteRecovery(id:string){return this.change((_d,s)=>{if(!s.recoveries?.some(r=>r.id===id))throw new Error('نسخه بازیابی یافت نشد.');s.recoveries=s.recoveries.filter(r=>r.id!==id);});}
  restoreBackup(snapshot:BackupSnapshot){const clean=cleanBackup(snapshot);return this.change(async(d,s)=>{const entries=Object.entries(clean.attachments??{});if(entries.length&&!this.attachments)throw new Error('محل نگهداری پیوست در دسترس نیست.');for(const [id,data] of entries)await verifyAttachment(id,data);for(const [id,data] of entries)await this.attachments!.put(id,data);this.checkpoint(s);d.ledger={...clean.ledger,aiConfig:d.ledger.aiConfig};s.draft=clean.draft;s.lastApproval=undefined;});}
  restoreRecovery(id?:string){return this.change(async(d,s)=>{const r=id?s.recoveries?.find(x=>x.id===id):s.recoveries?.[0];if(!r)throw new Error('نسخه بازیابی موجود نیست.');await this.ensureAttachments(snapshotAttachmentIds(r.ledger,r.draft));this.checkpoint(s);d.ledger={...r.ledger,aiConfig:d.ledger.aiConfig};s.draft=r.draft;s.lastApproval=undefined;});}
}
