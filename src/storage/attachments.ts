import type { ExpenseFields,LedgerData } from '../types/expense';
import type { DraftSession } from './ledgerRepository';
export const MAX_ATTACHMENT_BYTES=12*1024*1024;
export const ATTACHMENT_MIMES=['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv'] as const;
export interface AttachmentInventoryItem { id:string; storedBytes:number; }
export interface AttachmentAudit {referenced:number;missing:number;unreferenced:number;unreferencedBytes:number;storedBytes:number;}
export interface AttachmentCleanupResult {removed:number;releasedBytes:number;failed:number;skipped:number;}
export interface AttachmentStore { put(id:string,data:string):Promise<void>; get(id:string):Promise<string>; inventory?():Promise<AttachmentInventoryItem[]>; cleanup?(revision:number):Promise<AttachmentCleanupResult>; }
export function encodeBytes(bytes:Uint8Array){let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);}
export function decodeBytes(data:string){if(typeof data!=='string'||data.length>Math.ceil(MAX_ATTACHMENT_BYTES/3)*4||!data.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4!==0)throw new Error('محتوای پیوست نامعتبر است.');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(bytes.length>MAX_ATTACHMENT_BYTES)throw new Error('حجم پیوست بیش از حد مجاز است.');return bytes;}
export async function digestBytes(bytes:Uint8Array<ArrayBuffer>){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyAttachment(id:string,data:string){if(!/^[a-f0-9]{64}$/.test(id)||await digestBytes(decodeBytes(data))!==id)throw new Error('یکپارچگی فایل پیوست تأیید نشد.');}
export function attachmentIds(items:Pick<ExpenseFields,'attachmentId'|'attachmentMime'>[]):string[]{
 const ids=new Set<string>();for(const x of items){if(x.attachmentId===undefined&&x.attachmentMime===undefined)continue;if(typeof x.attachmentId!=='string'||!/^[a-f0-9]{64}$/.test(x.attachmentId)||!ATTACHMENT_MIMES.includes(x.attachmentMime as any))throw new Error('شناسه یا نوع پیوست نامعتبر است.');ids.add(x.attachmentId);}return [...ids];
}
export function snapshotAttachmentIds(ledger:LedgerData,draft:DraftSession|null){return attachmentIds([...ledger.expenses,...(draft?.drafts??[])]);}
export async function attachFile(store:AttachmentStore,file:File,kind:'image'|'pdf'|'text_file'){
 if(file.size<1||file.size>MAX_ATTACHMENT_BYTES)throw new Error('حجم فایل اصلی باید بین ۱ بایت و ۱۲ مگابایت باشد.');
 let mime=file.type.toLowerCase();
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(kind==='pdf')mime='application/pdf';
 else if(kind==='text_file')mime=ext==='csv'?'text/csv':'text/plain';
 else if(!mime||mime==='application/octet-stream')mime=({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'} as Record<string,string>)[ext??'']??'';
 if(!ATTACHMENT_MIMES.includes(mime as any)||(kind==='image'&&!mime.startsWith('image/')))throw new Error('نوع فایل اصلی پشتیبانی نمی‌شود.');
 const bytes=new Uint8Array(await file.arrayBuffer());const id=await digestBytes(bytes);await store.put(id,encodeBytes(bytes));return {attachmentId:id,attachmentMime:mime};
}

// Read-only audit; protect active documents, drafts, every recovery and approval replay records.
export function auditAttachmentInventory(items:AttachmentInventoryItem[],state:import('./sqliteStore').StoredState):AttachmentAudit {
 const referenced=new Set(snapshotAttachmentIds(state.ledger,state.draft));
 for(const r of state.recoveries??[])for(const id of snapshotAttachmentIds(r.ledger,r.draft))referenced.add(id);
 if(state.recovery)for(const id of snapshotAttachmentIds(state.recovery.ledger,state.recovery.draft))referenced.add(id);
 for(const id of attachmentIds(state.lastApproval?.records??[]))referenced.add(id);
 const seen=new Set<string>();let storedBytes=0,unreferencedBytes=0,unreferenced=0;
 for(const row of items){
  if(!/^[a-f0-9]{64}$/.test(row.id)||seen.has(row.id)||!Number.isSafeInteger(row.storedBytes)||row.storedBytes<0)throw new Error('فهرست پیوست نامعتبر است.');
  seen.add(row.id);storedBytes+=row.storedBytes;
  if(!referenced.has(row.id)){unreferenced++;unreferencedBytes+=row.storedBytes;}
 }
 return {referenced:referenced.size,missing:[...referenced].filter(id=>!seen.has(id)).length,unreferenced,unreferencedBytes,storedBytes};
}
