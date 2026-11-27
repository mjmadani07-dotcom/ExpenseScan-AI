import React,{useEffect,useState} from 'react';
import type {LedgerRepository} from '../storage/ledgerRepository';
import {encryptBackup,decryptBackup,type BackupSnapshot} from '../storage/portableBackup';
import {nativeSaveBackup} from '../storage/androidSnapshotStore';
export function BackupPanel({repository,onRestored}:{repository:LedgerRepository;onRestored:()=>Promise<void>}){
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
 const [preview,setPreview]=useState<BackupSnapshot|null>(null),[recovery,setRecovery]=useState<{createdAt:string;count:number}|null>(null);
 useEffect(()=>{repository.recoveryInfo?.().then(setRecovery).catch(()=>{});},[repository]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');setError(false);try{await fn();setRecovery(await repository.recoveryInfo!());}catch(e){setError(true);setMessage(e instanceof Error?e.message:'خطای پشتیبان‌گیری');}finally{setBusy(false);}};
 return <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
 <h2 className="text-base font-bold">پشتیبان‌گیری رمزگذاری‌شده و بازیابی</h2>
 <p className="text-xs text-slate-600">فایل قابل انتقال شامل دفتر مالی و پیش‌نویس است، نه کلید API یا تنظیمات اتصال. گذرواژه را جداگانه نگهداری کنید؛ بدون آن بازیابی ممکن نیست. پشتیبان را خارج از فضای خصوصی برنامه ذخیره کنید.</p>
 <label className="block text-xs font-semibold">گذرواژه فایل پشتیبان (حداقل ۱۲ نویسه)
 <input type={show?'text':'password'} autoComplete="new-password" value={password} onChange={e=>{setPassword(e.target.value);setPreview(null);}} className="w-full border rounded-lg p-2 mt-1" /></label>
 <label className="block text-xs font-semibold">تکرار گذرواژه برای خروجی
 <input type={show?'text':'password'} autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} className="w-full border rounded-lg p-2 mt-1"/></label>
 <label className="text-xs flex gap-2"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> نمایش گذرواژه</label>
 <button type="button" disabled={busy||password.length<12||password!==repeat} className="rounded-lg bg-teal-700 text-white p-3 text-xs disabled:opacity-40" onClick={()=>void run(async()=>{const data=await encryptBackup(await repository.exportBackup!(),password);await nativeSaveBackup('ExpenseScan-'+new Date().toISOString().slice(0,10)+'.esbackup',data);setPassword('');setRepeat('');setMessage('فایل پشتیبان رمزگذاری‌شده ذخیره شد.');})}>ذخیره فایل پشتیبان</button>
 <label className="block text-xs font-semibold">انتخاب فایل پشتیبان برای بازیابی
 <input type="file" accept=".esbackup,application/octet-stream" disabled={busy||!password} className="block mt-2 w-full text-xs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';setPreview(null);if(file)void run(async()=>{if(file.size>64*1024*1024)throw new Error('فایل بیش از حد بزرگ است.');setPreview(await decryptBackup(await file.text(),password));});}}/></label>
 {preview&&<div className="border border-amber-300 p-3 rounded-lg text-xs space-y-2"><p>فایل معتبر: {preview.ledger.expenses.length} سند، {preview.ledger.categories?.length??0} دسته‌بندی. بازیابی دفتر و پیش‌نویس فعلی را جایگزین می‌کند.</p><button type="button" disabled={busy} className="bg-red-700 text-white p-2 rounded-lg" onClick={()=>{if(window.confirm('دفتر فعلی با نسخه پشتیبان جایگزین شود؟'))void run(async()=>{await repository.restoreBackup!(preview);setPreview(null);setPassword('');setRepeat('');await onRestored();setMessage('بازیابی انجام شد.');});}}>تأیید بازیابی</button></div>}
 <div className="border-t pt-3 text-xs space-y-2"><p>بازیابی داخلی: پیش از حذف سند، پاکسازی، واردکردن فایل یا حذف دسته‌بندی، یک نسخه قبلی به‌صورت خودکار ذخیره می‌شود. این نسخه روی همین گوشی است و جای پشتیبان خارجی را نمی‌گیرد.</p>
 {recovery?<><p>{recovery.count} سند — {new Date(recovery.createdAt).toLocaleString('fa-IR')}</p><button type="button" disabled={busy} className="border rounded-lg p-2" onClick={()=>{if(window.confirm('نسخه قبلی جایگزین دفتر فعلی شود؟'))void run(async()=>{await repository.restoreRecovery!();await onRestored();setMessage('نسخه قبلی بازیابی شد.');});}}>بازیابی نسخه قبلی</button></>:<p>هنوز نسخه بازیابی داخلی وجود ندارد.</p>}</div>
 {busy&&<p role="status" className="text-xs">در حال پردازش…</p>}{message&&<p role={error?'alert':'status'} className={error?'text-red-700 text-xs':'text-teal-700 text-xs'}>{message}</p>}
 </section>;
}
