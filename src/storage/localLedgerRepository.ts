import type { AiConfig,CategoryBudget,ExchangeRates,ExpenseFields,ExpenseRecord,JsonImportMode } from '../types/expense';
import { LedgerDomain } from './ledgerDomain';
import type { DraftSession,LedgerRepository } from './ledgerRepository';
import type { SnapshotStore,StoredState } from './sqliteStore';

export class LocalLedgerRepository implements LedgerRepository {
  readonly mode='local' as const;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private readonly store:SnapshotStore){}
  initialize(){return this.store.initialize();}
  async load(){await this.queue.catch(()=>{});return (await this.store.read()).state.ledger;}
  async aiStatus(){return null;}
  async loadDraft(){await this.queue.catch(()=>{});return (await this.store.read()).state.draft;}
  private change<T>(fn:(domain:LedgerDomain,state:StoredState)=>T):Promise<T>{
    const task=this.queue.catch(()=>{}).then(async()=>{
      const {revision,state}=await this.store.read();
      const domain=new LedgerDomain(state.ledger);
      const result=fn(domain,state);
      state.ledger=domain.ledger;
      if(!await this.store.compareAndSwap(revision,state))throw new Error('دفتر هم‌زمان تغییر کرده است؛ دوباره بارگذاری کنید.');
      return result;
    });
    this.queue=task;
    return task;
  }
  saveDraft(draft:DraftSession|null){return this.change((_d,s)=>{s.draft=draft?structuredClone(draft):null;});}
  add(items:ExpenseFields[],draftId?:string){
    return this.change((d,s)=>{
      if(draftId&&s.lastApproval?.id===draftId)return s.lastApproval.records;
      if(draftId&&s.draft?.id!==draftId)throw new Error('پیش‌نویس تغییر کرده یا موجود نیست.');
      if(!items.length)throw new Error('سند انتخاب نشده است.');
      const created=d.addExpensesBatch(items);
      if(draftId){s.draft=null;s.lastApproval={id:draftId,records:created};}
      return created;
    });
  }
  update(id:string,patch:Partial<ExpenseFields>){return this.change(d=>{const record=d.updateExpense(id,patch);if(!record)throw new Error('سند یافت نشد.');return record;});}
  remove(id:string){return this.change(d=>{if(!d.deleteExpense(id))throw new Error('سند یافت نشد.');});}
  settings(budgets:CategoryBudget[],rates:ExchangeRates,aiConfig:AiConfig){return this.change(d=>d.updateSettings({budgets,rates,aiConfig}));}
  import(data:unknown,mode:JsonImportMode){return this.change(d=>d.importLedgerOnServer(data,mode));}
  clear(scope:'samples'|'all'){return this.change(d=>d.clearExpensesOnServer(scope));}
  addCategory(input:Parameters<LedgerDomain['addCategoryOnServer']>[0]){return this.change(d=>d.addCategoryOnServer(input));}
  updateCategory(id:string,patch:Parameters<LedgerDomain['updateCategoryOnServer']>[1]){return this.change(d=>{const result=d.updateCategoryOnServer(id,patch);if(!result)throw new Error('دسته‌بندی یافت نشد.');return result;});}
  deleteCategory(id:string,reassignToId?:string){return this.change(d=>d.deleteCategoryOnServer(id,reassignToId));}
}
