import { LocalLedgerRepository } from './localLedgerRepository';
import { ScopedLedgerStore,changeCatalog,createLedger,editLedgerProfile,validateMultiLedger,type MultiLedgerStore,type LedgerProfile,type MultiLedgerState } from './multiLedger';
import { canonicalJson } from './ledgerRows';
import type { AttachmentStore } from './attachments';
import type { DraftSession } from './ledgerRepository';

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
