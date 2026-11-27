import type { AiConfig,AiProviderStatus,CategoryBudget,CategoryDefinition,ExchangeRates,ExpenseFields,ExpenseRecord,ExtractedExpenseDraft,JsonImportMode,JsonImportStats,LedgerData } from '../types/expense';
import type { LedgerDomain } from './ledgerDomain';

export interface DraftSession { id:string; drafts:ExtractedExpenseDraft[]; previewPages:string[]; }
export interface LedgerRepository {
  readonly mode:'web'|'local';
  load():Promise<LedgerData>;
  loadActive?():Promise<{ledger:LedgerData;draft:DraftSession|null}>;
  aiStatus():Promise<AiProviderStatus|null>;
  add(items:ExpenseFields[], draftId?:string):Promise<ExpenseRecord[]>;
  update(id:string,patch:Partial<ExpenseFields>):Promise<ExpenseRecord>;
  remove(id:string):Promise<void>;
  settings(budgets:CategoryBudget[],rates:ExchangeRates,aiConfig:AiConfig):Promise<LedgerData & {aiStatus?:AiProviderStatus}>;
  import(data:unknown,mode:JsonImportMode):Promise<{ledger:LedgerData;stats:JsonImportStats}>;
  clear(scope:'samples'|'all'):Promise<{ledger:LedgerData;removedCount:number}>;
  addCategory(input:Parameters<LedgerDomain['addCategoryOnServer']>[0]):Promise<{ledger:LedgerData;category:CategoryDefinition}>;
  updateCategory(id:string,patch:Parameters<LedgerDomain['updateCategoryOnServer']>[1]):Promise<{ledger:LedgerData;category:CategoryDefinition}>;
  deleteCategory(id:string,reassignToId?:string):Promise<{ledger:LedgerData;reassignedCount:number}>;
  loadDraft?():Promise<DraftSession|null>;
  saveDraft?(draft:DraftSession|null):Promise<void>;
  attachmentAudit?():Promise<import('./attachments').AttachmentAudit>;
  cleanupAttachments?():Promise<import('./attachments').AttachmentCleanupResult>;
  exportStreamBackup?(password:string,sink:import('./streamBackup').ByteSink,progress?:import('./streamBackup').Progress,signal?:AbortSignal):Promise<number>;
  restoreStreamBackup?(file:Blob,password:string,progress?:import('./streamBackup').Progress,signal?:AbortSignal):Promise<void>;
  exportBackup?():Promise<import('./portableBackup').BackupSnapshot>;
  restoreBackup?(snapshot:import('./portableBackup').BackupSnapshot):Promise<void>;
  recoveryInfo?():Promise<{createdAt:string;count:number}|null>;
  restoreRecovery?(id?:string):Promise<void>;
  recoveryList?():Promise<{id:string;createdAt:string;count:number}[]>;
  createRecovery?():Promise<void>;
  deleteRecovery?(id:string):Promise<void>;
}

export class WebLedgerRepository implements LedgerRepository {
  readonly mode='web' as const;
  constructor(private readonly fetcher:typeof fetch = (...args) => globalThis.fetch(...args)) {}
  private async request<T>(url:string,method='GET',body?:unknown):Promise<T>{
    let res:Response;
    try { res=await this.fetcher(url,{method, ...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}); }
    catch { throw new Error('ارتباط با سرور برقرار نشد؛ نتیجه تغییر نامشخص است. پیش از تلاش مجدد دفتر را بررسی کنید.'); }
    const data=await res.json().catch(()=>null);
    if(!res.ok) throw new Error(data?.error || `خطای سرور (${res.status})`);
    if(data===null) throw new Error('پاسخ سرور نامعتبر است.');
    return data as T;
  }
  load(){return this.request<LedgerData>('/api/ledger');}
  aiStatus(){return this.request<AiProviderStatus>('/api/ai/status').catch(()=>null);}
  async add(items:ExpenseFields[]){const r=await this.request<{created:ExpenseRecord[]}>('/api/expenses/batch','POST',{expenses:items});if(!Array.isArray(r.created)||r.created.length!==items.length)throw new Error('پاسخ ثبت نامعتبر است.');return r.created;}
  async update(id:string,patch:Partial<ExpenseFields>){return (await this.request<{expense:ExpenseRecord}>('/api/expenses/'+encodeURIComponent(id),'PATCH',Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,v===undefined?null:v])))).expense;}
  async remove(id:string){await this.request('/api/expenses/'+encodeURIComponent(id),'DELETE');}
  settings(budgets:CategoryBudget[],rates:ExchangeRates,aiConfig:AiConfig){return this.request<LedgerData & {aiStatus?:AiProviderStatus}>('/api/settings','PUT',{budgets,rates,aiConfig});}
  import(data:unknown,mode:JsonImportMode){return this.request<{ledger:LedgerData;stats:JsonImportStats}>('/api/ledger/import','POST',{data,mode});}
  clear(scope:'samples'|'all'){return this.request<{ledger:LedgerData;removedCount:number}>('/api/ledger/clear','POST',{scope});}
  addCategory(input:Parameters<LedgerDomain['addCategoryOnServer']>[0]){return this.request<{ledger:LedgerData;category:CategoryDefinition}>('/api/categories','POST',input);}
  updateCategory(id:string,patch:Parameters<LedgerDomain['updateCategoryOnServer']>[1]){return this.request<{ledger:LedgerData;category:CategoryDefinition}>('/api/categories/'+encodeURIComponent(id),'PATCH',patch);}
  deleteCategory(id:string,reassignToId?:string){return this.request<{ledger:LedgerData;reassignedCount:number}>('/api/categories/'+encodeURIComponent(id),'DELETE',{reassignTo:reassignToId});}
}
