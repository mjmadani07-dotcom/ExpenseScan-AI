import { cleanBackupManifest,type BackupSnapshot } from './portableBackup';
import { snapshotAttachmentIds,decodeBytes,encodeBytes,digestBytes,MAX_ATTACHMENT_BYTES,type AttachmentStore } from './attachments';

export const STREAM_BACKUP_LIMIT=512*1024*1024;
const MANIFEST_LIMIT=32*1024*1024;
const MAX_FILES=10000;
const MAGIC=new TextEncoder().encode('ESBACK2\n');
export interface FramedBackupFormat<T>{magic:Uint8Array;clean(input:unknown):T;ids(manifest:T):string[];}
const HEADER_SIZE=32; // 8-byte magic, random 16-byte salt, random 8-byte nonce prefix
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export type BackupManifest=Pick<BackupSnapshot,'ledger'|'draft'>;
export interface StreamProgress {done:number;total:number;}
export type Progress=(value:StreamProgress)=>void;
export type ByteSink=(bytes:Uint8Array<ArrayBuffer>)=>Promise<void>;
function fail():never{throw new Error('فایل پشتیبان نامعتبر، ناقص یا آسیب‌دیده است، یا گذرواژه نادرست است.');}
function checkAbort(signal?:AbortSignal){if(signal?.aborted)throw new Error('عملیات پشتیبان‌گیری لغو شد.');}
function u32(n:number){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,false);return b;}
function equal(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
async function derive(password:string,header:Uint8Array<ArrayBuffer>){
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:header.slice(8,24),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function params(header:Uint8Array<ArrayBuffer>,index:number,length:number){
 const iv=new Uint8Array(12);iv.set(header.subarray(24,32));iv.set(u32(index),8);
 const aad=new Uint8Array(HEADER_SIZE+8);aad.set(header);aad.set(u32(index),HEADER_SIZE);aad.set(u32(length),HEADER_SIZE+4);
 return {name:'AES-GCM',iv,additionalData:aad,tagLength:128};
}
const singleFormat:FramedBackupFormat<BackupManifest>={magic:MAGIC,clean(input){
 const parsed=input as BackupManifest;
 if(!parsed||Object.keys(parsed).some(k=>k!=='ledger'&&k!=='draft'))return fail();
 return cleanBackupManifest(parsed);
},ids:manifest=>snapshotAttachmentIds(manifest.ledger,manifest.draft)};
function idsOf<T>(format:FramedBackupFormat<T>,manifest:T){
 const ids=[...new Set(format.ids(manifest))].sort();
 if(ids.length>MAX_FILES||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new Error('مجموعه پیوست‌های پشتیبان نامعتبر است یا از ظرفیت فعلی بیشتر است.');
 return ids;
}
export async function writeFramedBackup<T>(format:FramedBackupFormat<T>,snapshot:T,password:string,store:Pick<AttachmentStore,'get'>|undefined,sink:ByteSink,progress?:Progress,signal?:AbortSignal){
 if(password.length<12)throw new Error('گذرواژه پشتیبان باید حداقل ۱۲ نویسه باشد.');
 const manifest=format.clean(snapshot),ids=idsOf(format,manifest);
 if(ids.length&&!store)throw new Error('محل نگهداری پیوست در دسترس نیست.');
 const header=new Uint8Array(HEADER_SIZE);if(format.magic.length!==8)throw new Error('Invalid backup format');header.set(format.magic);header.set(crypto.getRandomValues(new Uint8Array(24)),8);
 const raw=enc.encode(JSON.stringify(manifest));if(raw.length>MANIFEST_LIMIT)throw new Error('حجم اطلاعات مالی از ظرفیت فعلی بیشتر است.');
 checkAbort(signal);const key=await derive(password,header);let size=0,index=0;
 const write=async(bytes:Uint8Array<ArrayBuffer>)=>{checkAbort(signal);size+=bytes.length;if(size>STREAM_BACKUP_LIMIT)throw new Error('حجم پشتیبان از سقف ۵۱۲ مگابایت بیشتر است.');await sink(bytes);};
 const frame=async(data:Uint8Array<ArrayBuffer>)=>{checkAbort(signal);const length=data.length+16;const cipher=new Uint8Array(await crypto.subtle.encrypt(params(header,index++,length),key,data));await write(u32(length));await write(cipher);};
 await write(header);await frame(raw);progress?.({done:0,total:ids.length});
 for(let i=0;i<ids.length;i++){
  checkAbort(signal);const bytes=decodeBytes(await store!.get(ids[i]));if(await digestBytes(bytes)!==ids[i])throw new Error('یکپارچگی پیوست تأیید نشد.');
  await frame(bytes);progress?.({done:i+1,total:ids.length});
 }
 // Authenticated terminator makes truncation and trailing bytes invalid.
 await frame(new Uint8Array(0));return size;
}
export async function hasFramedMagic(file:Blob,magic:Uint8Array){return file.size>=magic.length&&equal(new Uint8Array(await file.slice(0,magic.length).arrayBuffer()),magic);}
async function reader<T>(format:FramedBackupFormat<T>,file:Blob,password:string,signal?:AbortSignal){
 if(file.size>STREAM_BACKUP_LIMIT||file.size<HEADER_SIZE+4+16)return fail();
 let offset=0,index=0;
 async function take(n:number){checkAbort(signal);if(!Number.isSafeInteger(n)||n<0||offset+n>file.size)return fail();const b=new Uint8Array(await file.slice(offset,offset+n).arrayBuffer());offset+=n;if(b.length!==n)return fail();return b;}
 const header=await take(HEADER_SIZE);if(!equal(header.subarray(0,8),format.magic))return fail();
 const key=await derive(password,header);
 async function frame(max:number){
  const length=new DataView((await take(4)).buffer).getUint32(0,false);
  if(length<16||length>max+16)return fail();
  try{return new Uint8Array(await crypto.subtle.decrypt(params(header,index++,length),key,await take(length)));}catch(e){if(signal?.aborted)throw e;return fail();}
 }
 const bytes=await frame(MANIFEST_LIMIT);
 let manifest:T;
 try{manifest=format.clean(JSON.parse(dec.decode(bytes)));}catch{return fail();}
 return {manifest,ids:idsOf(format,manifest),frame,atEnd:()=>offset===file.size};
}
export async function previewFramedBackup<T>(format:FramedBackupFormat<T>,file:Blob,password:string,signal?:AbortSignal){
 const r=await reader(format,file,password,signal);return {manifest:r.manifest,attachmentCount:r.ids.length};
}
export async function readFramedBackup<T>(format:FramedBackupFormat<T>,file:Blob,password:string,store:Pick<AttachmentStore,'put'>|undefined,progress?:Progress,signal?:AbortSignal){
 const r=await reader(format,file,password,signal);if(r.ids.length&&!store)throw new Error('محل نگهداری پیوست در دسترس نیست.');
 progress?.({done:0,total:r.ids.length});
 for(let i=0;i<r.ids.length;i++){
  const bytes=await r.frame(MAX_ATTACHMENT_BYTES);if(!bytes.length||await digestBytes(bytes)!==r.ids[i])return fail();
  checkAbort(signal);await store!.put(r.ids[i],encodeBytes(bytes));progress?.({done:i+1,total:r.ids.length});
 }
 if((await r.frame(0)).length!==0||!r.atEnd())return fail();
 checkAbort(signal);return r.manifest;
}

// Keep the v2 public API and byte format unchanged for legacy devices/files.
export const writeStreamBackup=(snapshot:BackupManifest,password:string,store:Pick<AttachmentStore,'get'>|undefined,sink:ByteSink,progress?:Progress,signal?:AbortSignal)=>writeFramedBackup(singleFormat,snapshot,password,store,sink,progress,signal);
export const isStreamBackup=(file:Blob)=>hasFramedMagic(file,MAGIC);
export const previewStreamBackup=(file:Blob,password:string,signal?:AbortSignal)=>previewFramedBackup(singleFormat,file,password,signal);
export const readStreamBackup=(file:Blob,password:string,store:Pick<AttachmentStore,'put'>|undefined,progress?:Progress,signal?:AbortSignal)=>readFramedBackup(singleFormat,file,password,store,progress,signal);
