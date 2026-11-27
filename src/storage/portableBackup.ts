import { snapshotAttachmentIds,verifyAttachment,decodeBytes } from './attachments';
import type { LedgerData } from '../types/expense';
import type { DraftSession } from './ledgerRepository';
import { decodeStoredState } from './sqliteStore';
export interface BackupSnapshot { ledger:LedgerData; draft:DraftSession|null; attachments?:Record<string,string>; }
const ITERATIONS=600000;
const LIMIT=32*1024*1024;
const label='ExpenseScan portable backup v1';
const enc=new TextEncoder();
function b64(bytes:Uint8Array){let out='';for(let i=0;i<bytes.length;i+=16384)out+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(out);}
function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function key(password:string,salt:Uint8Array<ArrayBuffer>){
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function cleanBackup(snapshot:BackupSnapshot):BackupSnapshot{
 const {aiConfig:_config,...ledger}=snapshot.ledger;
 // No provider secrets, URLs or prior approval tokens in portable backups.
 const validated=decodeStoredState(JSON.stringify({ledger,draft:snapshot.draft}));
 const {aiConfig:_default,...clean}=validated.ledger;
 const ids=snapshotAttachmentIds(clean,validated.draft), blobs=snapshot.attachments??{};
 if(!blobs||typeof blobs!=='object'||Array.isArray(blobs)||Object.keys(blobs).length!==ids.length)throw new Error('مجموعه پیوست‌های فایل پشتیبان کامل نیست.');
 for(const id of ids){if(!Object.hasOwn(blobs,id))throw new Error('پیوست در فایل پشتیبان موجود نیست.');decodeBytes(blobs[id]);}
 return {ledger:clean,draft:validated.draft,...(ids.length?{attachments:blobs}:{})};
}
export async function encryptBackup(snapshot:BackupSnapshot,password:string):Promise<string>{
 if(password.length<12)throw new Error('گذرواژه پشتیبان باید حداقل ۱۲ نویسه باشد.');
 const clean=cleanBackup(snapshot);for(const [id,data] of Object.entries(clean.attachments??{}))await verifyAttachment(id,data);
 const raw=enc.encode(JSON.stringify(clean));
 if(raw.length>LIMIT)throw new Error('حجم پشتیبان بیش از حد مجاز است.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(label)},await key(password,salt),raw);
 return JSON.stringify({format:'expensescan-encrypted-backup',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))});
}
export async function decryptBackup(text:string,password:string):Promise<BackupSnapshot>{
 try{
  if(text.length>64*1024*1024)throw Error();
  const v=JSON.parse(text);
  if(v.format!=='expensescan-encrypted-backup'||v.version!==1||v.kdf!=='PBKDF2-SHA256'||v.iterations!==ITERATIONS||typeof v.salt!=='string'||typeof v.iv!=='string'||typeof v.ciphertext!=='string')throw Error();
  const salt=unb64(v.salt),iv=unb64(v.iv),cipher=unb64(v.ciphertext);
  if(salt.length!==16||iv.length!==12||cipher.length>LIMIT+16)throw Error();
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(label)},await key(password,salt),cipher);
  const clean=cleanBackup(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));for(const [id,data] of Object.entries(clean.attachments??{}))await verifyAttachment(id,data);return clean;
 }catch{throw new Error('گذرواژه اشتباه است یا فایل پشتیبان نامعتبر یا آسیب‌دیده است. داده‌های فعلی تغییر نکردند.');}
}
