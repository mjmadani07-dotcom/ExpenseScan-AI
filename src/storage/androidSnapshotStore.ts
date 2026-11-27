import { emptyLedger } from './ledgerDomain';
import { decodeStoredState, type SnapshotStore, type StoredState } from './sqliteStore';

interface NativeLedgerBridge {
  initialize(options:{initialPayload:string}):Promise<void>;
  read():Promise<{revision:number;payload:string}>;
  compareAndSwap(options:{revision:string;payload:string}):Promise<{committed:boolean}>;
  minimize():Promise<void>;
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
  async initialize(){
    await bridge().initialize({initialPayload:JSON.stringify({ledger:emptyLedger(),draft:null})});
    await this.read();
  }
  async read(){
    const row=await bridge().read();
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('نسخه دفتر معتبر نیست.');
    return {revision:row.revision,state:decodeStoredState(row.payload)};
  }
  async compareAndSwap(revision:number,state:StoredState){
    const payload=JSON.stringify(state);decodeStoredState(payload);
    return (await bridge().compareAndSwap({revision:String(revision),payload})).committed===true;
  }
}

export async function nativeLoadKeys(){return JSON.parse((await bridge().loadKeys()).keys);}
export async function nativeSaveKey(provider:string,value:string){return JSON.parse((await bridge().saveKey({provider,value})).keys);}
export async function nativeSaveBackup(name:string,data:string){await bridge().saveBackupFile({name,data});}
