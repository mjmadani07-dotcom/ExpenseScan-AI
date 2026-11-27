import React,{useEffect,useRef,useState} from 'react';
import { Archive,ArrowLeft,Building2,CheckCircle2,Lock,Plus,RotateCcw,Settings2 } from 'lucide-react';
import App from '../App';
import type { LedgerCatalogItem,MultiLedgerSession,OpenWorkspace } from '../storage/multiLedgerSession';
import type { DraftSession } from '../storage/ledgerRepository';
import { WorkspaceActivityProvider } from './WorkspaceActivity';
const COLORS=['#0f766e','#2563eb','#7c3aed','#b45309','#be185d','#475569'];
const message=(e:unknown)=>e instanceof Error?e.message:'عملیات ناموفق بود؛ دوباره تلاش کنید.';
export function LedgerCatalog({items,busy,error,onOpen,onCreate,onEdit,onLock,onRefresh}:{items:LedgerCatalogItem[];busy:boolean;error:string;onOpen:(id:string)=>void;onCreate:(name:string,color:string)=>void;onEdit:(id:string,patch:{name?:string;color?:string;archived?:boolean})=>void;onLock:()=>void;onRefresh:()=>void}){
 const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[color,setColor]=useState(COLORS[0]),[archived,setArchived]=useState(false);
 const begin=(item?:LedgerCatalogItem)=>{setEditing(item?item.profile.id:'new');setName(item?.profile.name??'');setColor(item?.profile.color??COLORS[0]);};
 const submit=(e:React.FormEvent)=>{e.preventDefault();if(busy||!name.trim())return;if(editing==='new')onCreate(name,color);else if(editing)onEdit(editing,{name,color});setEditing(null);};
 const visible=items.filter(x=>archived?x.profile.archived:!x.profile.archived);
 return <main dir="rtl" className="min-h-screen bg-slate-50 text-slate-900 px-4 py-5">
  <div className="max-w-2xl mx-auto space-y-4">
   <header className="flex items-center justify-between gap-2"><div><p className="text-xs text-teal-700 font-bold">حساب‌یار</p><h1 className="text-xl font-bold">دفاتر مالی</h1></div><button type="button" onClick={onLock} className="min-h-11 px-3 rounded-xl border bg-white flex items-center gap-2 text-xs"><Lock size={16}/> قفل برنامه</button></header>
   <p className="text-sm text-slate-600">برای ثبت و ویرایش هزینه‌ها یک دفتر را باز کنید. اسناد، پیش‌نویس‌ها، بودجه و دسته‌بندی هر دفتر مستقل است.</p>
   <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">محیط آزمایش داخلی چنددفتره؛ تا تأیید پشتیبان‌گیری همه دفاتر، از اطلاعات واقعی استفاده نکنید.</div>
   {error&&<div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}<button type="button" disabled={busy} onClick={onRefresh} className="mr-2 underline">بارگذاری مجدد</button></div>}
   <div className="flex items-center justify-between gap-2 flex-wrap">
    <div className="flex bg-slate-200 p-1 rounded-xl text-xs"><button type="button" aria-pressed={!archived} disabled={busy} onClick={()=>{setArchived(false);setEditing(null);}} className={'min-h-10 px-3 rounded-lg '+(!archived?'bg-white font-bold':'')}>فعال ({items.filter(x=>!x.profile.archived).length.toLocaleString('fa-IR')})</button><button type="button" aria-pressed={archived} disabled={busy} onClick={()=>{setArchived(true);setEditing(null);}} className={'min-h-10 px-3 rounded-lg '+(archived?'bg-white font-bold':'')}>بایگانی ({items.filter(x=>x.profile.archived).length.toLocaleString('fa-IR')})</button></div>
    <button type="button" disabled={busy||items.length>=100} onClick={()=>{setArchived(false);begin();}} className="min-h-11 px-3 rounded-xl bg-teal-700 text-white flex items-center gap-2 text-xs font-bold disabled:opacity-50"><Plus size={17}/> دفتر جدید</button>
   </div>
   {editing!==null&&<form onSubmit={submit} className="rounded-2xl border border-teal-200 bg-white p-4 space-y-3"><h2 className="font-bold text-sm">{editing==='new'?'ایجاد دفتر مالی':'ویرایش مشخصات دفتر'}</h2><label className="block text-xs font-semibold">نام دفتر<input autoFocus required maxLength={80} disabled={busy} value={name} onChange={e=>setName(e.target.value)} placeholder="مثلاً دفتر کرج" className="mt-1 w-full min-h-11 border rounded-lg px-3 text-sm"/></label><fieldset><legend className="text-xs font-semibold mb-2">رنگ دفتر</legend><div className="flex flex-wrap gap-2">{Array.from(new Set([...COLORS,color])).map(c=><button type="button" key={c} disabled={busy} aria-label={'رنگ '+c} aria-pressed={color===c} onClick={()=>setColor(c)} style={{backgroundColor:c}} className="w-10 h-10 rounded-xl flex items-center justify-center text-white ring-offset-2 aria-pressed:ring-2 ring-slate-700">{color===c&&<CheckCircle2 size={19}/>}</button>)}</div></fieldset><div className="flex gap-2"><button type="submit" disabled={busy||!name.trim()} className="min-h-11 px-4 rounded-xl bg-teal-700 text-white text-xs font-bold disabled:opacity-50">ذخیره دفتر</button><button type="button" onClick={()=>setEditing(null)} className="min-h-11 px-3 rounded-xl border text-xs">انصراف</button></div></form>}
   {busy&&<p role="status" className="text-xs text-slate-600">در حال پردازش…</p>}
   <div className="space-y-2">{visible.map(item=><article key={item.profile.id} className="rounded-2xl border bg-white p-3 space-y-3">
    <div className="flex gap-3 items-center"><div style={{color:item.profile.color,borderColor:item.profile.color}} className="w-11 h-11 rounded-xl border-2 flex items-center justify-center shrink-0"><Building2 size={21}/></div><div className="min-w-0 flex-1"><h2 className="font-bold text-sm break-words">{item.profile.name}</h2><p className="text-xs text-slate-500">{item.count.toLocaleString('fa-IR')} سند{item.hasDraft?' · پیش‌نویس ذخیره‌شده':''}</p></div>{!item.profile.archived&&<button type="button" disabled={busy||editing!==null} onClick={()=>onOpen(item.profile.id)} className="min-h-11 rounded-xl bg-teal-50 text-teal-800 px-3 text-xs font-bold flex items-center gap-1 disabled:opacity-50">ورود به دفتر <ArrowLeft size={14}/></button>}</div>
    <div className="border-t pt-2 flex gap-2 flex-wrap"><button type="button" disabled={busy} onClick={()=>begin(item)} className="min-h-10 flex items-center gap-1 px-2 text-xs text-slate-700"><Settings2 size={15}/> ویرایش مشخصات</button>{item.profile.archived?<button type="button" disabled={busy} onClick={()=>onEdit(item.profile.id,{archived:false})} className="min-h-10 px-2 text-xs flex items-center gap-1 text-teal-800"><RotateCcw size={15}/> فعال‌سازی</button>:<button type="button" disabled={busy||item.hasDraft||items.filter(x=>!x.profile.archived).length<=1} onClick={()=>{if(window.confirm('دفتر «'+item.profile.name+'» بایگانی شود؟ اسناد حذف نمی‌شوند.'))onEdit(item.profile.id,{archived:true});}} className="min-h-10 px-2 text-xs flex items-center gap-1 text-slate-600 disabled:opacity-40"><Archive size={15}/> بایگانی</button>}</div>
   </article>)}</div>
   {!visible.length&&!busy&&<p className="text-center text-sm text-slate-500 p-6">{archived?'دفتر بایگانی‌شده‌ای وجود ندارد.':'دفتر فعالی یافت نشد.'}</p>}
  </div>
 </main>;
}
export function MultiLedgerWorkspace({session,onLock}:{session:MultiLedgerSession;onLock:()=>void}){
 const [items,setItems]=useState<LedgerCatalogItem[]>([]),[active,setActive]=useState<OpenWorkspace|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const operating=useRef(false),alive=useRef(true);
 const run=async(fn:()=>Promise<void>)=>{if(operating.current)return;operating.current=true;setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(message(e));}finally{operating.current=false;if(alive.current)setBusy(false);}};
 const refresh=async()=>{const next=await session.catalog();if(alive.current)setItems(next);};
 useEffect(()=>{alive.current=true;void run(refresh);return()=>{alive.current=false;};},[session]);
 const close=async(draft:DraftSession|null)=>{
   if(operating.current)throw new Error('عملیات دیگری در حال انجام است.');
   operating.current=true;setBusy(true);
   try{await session.close(draft);if(alive.current){setActive(null);setError('');}try{await refresh();}catch(e){if(alive.current)setError(message(e));}}
   finally{operating.current=false;if(alive.current)setBusy(false);}
 };
 if(active)return <WorkspaceActivityProvider key={active.profile.id}><App key={active.profile.id} repository={active.repository} onLock={onLock} workspace={{profile:active.profile,onExit:close}}/></WorkspaceActivityProvider>;
 return <LedgerCatalog items={items} busy={busy} error={error} onLock={onLock} onRefresh={()=>void run(refresh)}
   onOpen={id=>void run(async()=>{const next=await session.open(id);if(alive.current)setActive(next);else next.repository.dispose();})}
   onCreate={(name,color)=>void run(async()=>{const next=await session.create(name,color);if(alive.current)setItems(next);})}
   onEdit={(id,patch)=>void run(async()=>{const next=await session.edit(id,patch);if(alive.current)setItems(next);})}/>;
}
