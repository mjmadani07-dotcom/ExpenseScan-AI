import React,{useEffect,useRef,useState} from 'react';
import type {LedgerCatalogItem,MultiLedgerSession} from '../storage/multiLedgerSession';
import {nativeWriteStreamBackup} from '../storage/androidSnapshotStore';
import {STREAM_BACKUP_LIMIT,type StreamProgress} from '../storage/streamBackup';
type Preview=Awaited<ReturnType<MultiLedgerSession['previewBackup']>>;
const filename=(prefix:string)=>prefix+'-'+new Date().toISOString().slice(0,10)+'-'+Date.now()+'.esbackup3';
export function MultiLedgerBackupPanel({session,items,onBack,onLock,onRestored}:{session:MultiLedgerSession;items:LedgerCatalogItem[];onBack:()=>void;onLock:()=>void;onRestored:(items:LedgerCatalogItem[])=>void}){
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[show,setShow]=useState(false);
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState<StreamProgress|null>(null),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const abortRef=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abortRef.current?.abort();};},[]);
 const run=async(fn:(signal:AbortSignal)=>Promise<void>)=>{
  if(abortRef.current)return;const abort=new AbortController();abortRef.current=abort;setBusy(true);setProgress(null);setNotice('');setError('');
  try{await fn(abort.signal);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'عملیات ناموفق بود.');}
  finally{abortRef.current=null;if(alive.current){setBusy(false);setProgress(null);}}
 };
 const updatePassword=(value:string)=>{setPassword(value);setPreview(null);setConfirmed(false);};
 const clear=()=>{setPassword('');setRepeat('');setFile(null);setPreview(null);setConfirmed(false);};
 const exportAll=()=>void run(async signal=>{
  await nativeWriteStreamBackup(filename('HesabYar-all'),sink=>session.writeBackup(password,sink,setProgress,signal),signal);
  if(alive.current){clear();setNotice('پشتیبان همه دفاتر ذخیره شد.');}
 });
 const inspect=()=>{if(!file)return;setPreview(null);setConfirmed(false);void run(async signal=>{
  if(file.size>STREAM_BACKUP_LIMIT)throw new Error('حجم پشتیبان بیش از ۵۱۲ مگابایت است.');
  const result=await session.previewBackup(file,password,signal);if(alive.current)setPreview(result);
 });};
 const restore=()=>{if(!file||!preview||!confirmed||password.length<12||password!==repeat)return;
  void run(async signal=>{
   const next=await session.restoreBackup(file,password,preview,write=>nativeWriteStreamBackup(filename('HesabYar-before-restore'),write,signal),password,setProgress,signal);
   if(alive.current){onRestored(next);clear();setNotice('بازیابی همه دفاتر انجام شد. پشتیبان ایمنی جداگانه ذخیره شد.');}
  });
 };
 const field='block mt-1 w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm';
 const btn='min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-40';
 return <main dir="rtl" className="min-h-screen bg-slate-50 p-4"><div className="max-w-2xl mx-auto space-y-4">
 <header className="flex gap-2 items-center justify-between"><button type="button" disabled={busy} onClick={onBack} className={btn+' border bg-white'}>دفاتر مالی</button><h1 className="font-bold text-base">پشتیبان همه دفاتر</h1><button type="button" onClick={onLock} className={btn+' border bg-white'}>قفل</button></header>
 <section className="rounded-2xl bg-white border p-4 space-y-3">
 <p className="text-xs leading-relaxed">فایل ESBACK3 شامل همه دفاتر فعال و بایگانی، پیش‌نویس‌ها، آرشیو بازیابی و اصل پیوست‌هاست؛ بدون کلید API یا تنظیمات اتصال. سقف فایل ۵۱۲ مگابایت است. گذرواژه را جداگانه و یک نسخه از فایل را خارج از گوشی نگهداری کنید.</p>
 <p className="text-xs text-slate-600">{items.length.toLocaleString('fa-IR')} دفتر · {items.reduce((sum,i)=>sum+i.count,0).toLocaleString('fa-IR')} سند</p>
 <label className="block text-xs font-semibold">گذرواژه پشتیبان (حداقل ۱۲ نویسه)<input id="multi-backup-password" type={show?'text':'password'} autoComplete="new-password" disabled={busy} value={password} onChange={e=>updatePassword(e.target.value)} className={field}/></label>
 <label className="block text-xs font-semibold">تکرار گذرواژه برای ذخیره یا بازیابی<input id="multi-backup-repeat" type={show?'text':'password'} autoComplete="new-password" disabled={busy} value={repeat} onChange={e=>{setRepeat(e.target.value);setConfirmed(false);}} className={field}/></label>
 <label className="flex gap-2 text-xs items-center"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> نمایش گذرواژه</label>
 <button type="button" disabled={busy||password.length<12||password!==repeat} onClick={exportAll} className={btn+' bg-teal-700 text-white w-full'}>ذخیره پشتیبان همه دفاتر</button>
 <p className="text-xs text-slate-500">در اندروید ۱۰ و بالاتر فایل پس از بررسی صحت در Downloads/HesabYar ذخیره می‌شود.</p>
 </section>
 <section className="rounded-2xl bg-white border p-4 space-y-3">
 <h2 className="font-bold text-sm">بازیابی کامل</h2>
 <p className="text-xs text-slate-600">فقط فایل چنددفتره معتبر برای جایگزینی کامل پذیرفته می‌شود. فایل قدیمی تک‌دفتره نباید همه دفاتر را جایگزین کند.</p>
 <label className="block text-xs font-semibold">انتخاب فایل پشتیبان<input id="multi-backup-file" type="file" accept=".esbackup3,.esbackup2,.esbackup,application/octet-stream" disabled={busy} className="block w-full text-xs mt-2" onChange={e=>{setFile(e.target.files?.[0]??null);e.target.value='';setPreview(null);setConfirmed(false);setNotice('');setError('');}}/></label>
 {file&&<p className="text-xs break-all">{file.name}</p>}
 <button type="button" disabled={busy||!file||!password} onClick={inspect} className={btn+' border bg-white w-full'}>بررسی پشتیبان چنددفتره</button>
 {preview&&<div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-3 text-xs">
 <h3 className="font-bold">پیش‌نمایش دفاتر قابل بازیابی</h3>
 {preview.manifest.workspaces.map(w=><p key={w.profile.id} className="break-words">{w.profile.name} · {w.profile.archived?'بایگانی':'فعال'} · {w.state.ledger.expenses.length.toLocaleString('fa-IR')} سند{w.state.draft?' · پیش‌نویس':''}</p>)}
 <p>{preview.attachmentCount.toLocaleString('fa-IR')} فایل اصلی؛ صحت همه فایل‌ها پیش از جایگزینی بررسی می‌شود.</p>
 <p className="text-red-900 font-semibold">تمام {items.length.toLocaleString('fa-IR')} دفتر فعلی با دفاتر فایل انتخابی جایگزین می‌شوند. ابتدا یک فایل پشتیبان ایمنی جداگانه با همین گذرواژه ساخته و صحت ذخیره آن بررسی خواهد شد.</p>
 <label className="flex gap-2 items-start"><input id="multi-restore-confirm" type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> جایگزینی تمام دفاتر را پس از تهیه پشتیبان ایمنی تأیید می‌کنم.</label>
 <button type="button" disabled={busy||!confirmed||password.length<12||password!==repeat} onClick={restore} className={btn+' bg-red-700 text-white w-full'}>تأیید بازیابی همه دفاتر</button>
 </div>}
 </section>
 {busy&&<p role="status" className="text-sm">در حال پردازش… {progress?progress.done.toLocaleString('fa-IR')+' از '+progress.total.toLocaleString('fa-IR')+' پیوست':''}</p>}
 {notice&&<p role="status" className="rounded-xl p-3 bg-teal-50 text-teal-900 text-sm">{notice}</p>}
 {error&&<p role="alert" className="rounded-xl p-3 bg-red-50 text-red-900 text-sm">{error}</p>}
 </div></main>;
}
