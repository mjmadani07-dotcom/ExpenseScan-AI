import { assembleLedger,canonicalJson,diffLedgerRows,partitionLedger,type LedgerRow } from './ledgerRows';
import { type AttachmentStore,attachFile,decodeBytes,verifyAttachment } from './attachments';
import { toEnglishDigits } from '../utils/jalali';
import { emptyLedger } from './ledgerDomain';
import { decodeStoredState, type SnapshotStore, type StoredState } from './sqliteStore';

interface NativeLedgerBridge {
  initialize(options:{initialPayload:string}):Promise<void>;
  read():Promise<{revision:number;schema:number;payload?:string;rows?:string}>;
  commitRows(options:{revision:string;patch:string;migration:boolean}):Promise<{committed:boolean}>;
  minimize():Promise<void>;
  sessionStatus():Promise<{unlocked:boolean;deviceSecure:boolean;biometricAvailable?:boolean}>;
  unlockBiometric():Promise<void>;
  unlockApp():Promise<void>;
  lockApp():Promise<void>;
  noteActivity():Promise<void>;
  saveExportFile(options:{name:string;data:string;mime:string}):Promise<void>;
  putAttachment(options:{id:string;data:string}):Promise<void>;
  readAttachment(options:{id:string}):Promise<{data:string}>;
  attachmentInventory():Promise<{items:string}>;
  loadKeys():Promise<{keys:string}>;
  saveKey(options:{provider:string;value:string}):Promise<{keys:string}>;
  saveBackupFile(options:{name:string;data:string}):Promise<void>;
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
    const row=await bridge().read();
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('نسخه دفتر معتبر نیست.');
    if(row.schema===2){
      if(typeof row.payload!=='string')throw new Error('دفتر قبلی قابل خواندن نیست.');
      const old=decodeStoredState(row.payload),rows=partitionLedger(old);
      if(canonicalJson(assembleLedger(rows))!==canonicalJson(old))throw new Error('مهاجرت دفتر بدون تغییر داده‌ها تأیید نشد.');
      const result=await bridge().commitRows({revision:String(row.revision),migration:true,patch:JSON.stringify(diffLedgerRows([],rows))});
      if(!result.committed)throw new Error('دفتر هم‌زمان تغییر کرد؛ مهاجرت را دوباره انجام دهید.');
    }else if(row.schema!==3)throw new Error('نسخه پایگاه داده پشتیبانی نمی‌شود.');
    await this.read();
  }
  async read(){
    const row=await bridge().read();
    if(!Number.isSafeInteger(row.revision)||row.revision<0||row.schema!==3||typeof row.rows!=='string')throw new Error('نسخه دفتر معتبر نیست.');
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
 async inventory(){return JSON.parse((await bridge().attachmentInventory()).items);},
 async put(id,data){await verifyAttachment(id,data);await bridge().putAttachment({id,data});},
 async get(id){const result=await bridge().readAttachment({id});await verifyAttachment(id,result.data);return result.data;}
};
export const nativeAttachFile=(file:File,kind:'image'|'pdf'|'text_file')=>attachFile(androidAttachments,file,kind);
export async function nativeExportAttachment(id:string,mime:string){const data=decodeBytes(await androidAttachments.get(id));const ext:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','text/plain':'txt','text/csv':'csv'};if(!ext[mime])throw new Error('نوع پیوست نامعتبر است.');await nativeExportFile('attachment-'+id.slice(0,12)+'.'+ext[mime],data,mime);}
