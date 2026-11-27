import React,{useEffect,useRef,useState} from 'react';
import App from '../App';
import { AndroidSnapshotStore,androidAttachments,nativeActivity,nativeLock,nativeSessionStatus,nativeUnlock } from '../storage/androidSnapshotStore';
import { LocalLedgerRepository } from '../storage/localLedgerRepository';

export function AndroidAuthGate(){
 const [repo,setRepo]=useState<LocalLedgerRepository|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[secure,setSecure]=useState<boolean|null>(null),[biometric,setBiometric]=useState(false);
 const current=useRef<LocalLedgerRepository|null>(null),attempt=useRef(false),lastTouch=useRef(0);
 const drop=()=>{current.current=null;setRepo(null);};
 useEffect(()=>{
   let disposed=false;
   const check=async()=>{try{const s=await nativeSessionStatus();if(disposed)return;setSecure(s.deviceSecure);setBiometric(s.biometricAvailable===true);if(!s.unlocked&&!attempt.current)drop();}catch{if(!disposed&&!attempt.current){drop();setError('بررسی وضعیت قفل دستگاه ناموفق بود.');}}};
   const touch=()=>{if(!current.current||document.hidden||Date.now()-lastTouch.current<1000)return;lastTouch.current=Date.now();void nativeActivity().catch(()=>{drop();});};
   const visibility=()=>{if(!document.hidden)void check();};
   const interval=window.setInterval(()=>{if(!document.hidden)void check();},1000);
   window.addEventListener('pointerdown',touch,true);window.addEventListener('keydown',touch,true);document.addEventListener('visibilitychange',visibility);
   void check();
   return ()=>{disposed=true;window.clearInterval(interval);window.removeEventListener('pointerdown',touch,true);window.removeEventListener('keydown',touch,true);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const unlock=async(useBiometric=false)=>{if(attempt.current)return;attempt.current=true;setBusy(true);setError('');
   try{await nativeUnlock(useBiometric);const next=new LocalLedgerRepository(new AndroidSnapshotStore(),androidAttachments);await next.initialize();current.current=next;setRepo(next);}
   catch(e){drop();setError(e instanceof Error?e.message:'ورود ناموفق بود.');}
   finally{attempt.current=false;setBusy(false);}
 };
 const lock=async()=>{try{await nativeLock();}finally{drop();}};
 if(repo)return <App repository={repo} onLock={()=>void lock()}/>;
 return <main dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="bg-white border rounded-2xl max-w-sm w-full p-6 space-y-4"><h1 className="text-xl font-bold text-teal-800">حساب‌یار قفل است</h1><p className="text-sm text-slate-600">برای دسترسی به دفتر مالی، از بیومتریک امن (در صورت پشتیبانی گوشی) یا PIN، الگو و گذرواژه دستگاه استفاده کنید.</p>{secure===false&&<p role="alert" className="text-red-700 text-sm">ابتدا در تنظیمات امنیتی گوشی قفل صفحه را فعال کنید.</p>}{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}{biometric&&<button type="button" disabled={busy} onClick={()=>void unlock(true)} className="bg-teal-700 text-white rounded-xl w-full p-3 disabled:opacity-50">ورود با اثر انگشت / بیومتریک</button>}<button type="button" disabled={busy||secure===false} onClick={()=>void unlock()} className="bg-teal-700 text-white rounded-xl w-full p-3 disabled:opacity-50">{busy?'در حال احراز هویت…':'ورود با رمز گوشی'}</button><p className="text-xs text-slate-500">قفل خودکار: ۵ دقیقه عدم فعالیت یا ۳۰ ثانیه خروج از برنامه. هیچ رمز گوشی در حساب‌یار ذخیره نمی‌شود.</p></div></main>;
}
