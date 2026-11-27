import React,{lazy,Suspense,useEffect,useState} from 'react';
import {androidAttachments,isAndroidRuntime} from '../storage/androidSnapshotStore';
import {readAttachmentPreview,type PreviewContent} from '../utils/attachmentPreview';
const PdfPreview=lazy(()=>import('./AttachmentPdfPreview'));
function ImagePreview({blob}:{blob:Blob}){
 const [url,setUrl]=useState(''),[zoom,setZoom]=useState(100),[error,setError]=useState(false);
 useEffect(()=>{const next=URL.createObjectURL(blob);setUrl(next);return ()=>URL.revokeObjectURL(next);},[blob]);
 return <div className="space-y-2"><label className="flex items-center gap-2 text-xs">بزرگ‌نمایی <select value={zoom} onChange={e=>setZoom(Number(e.target.value))} className="border rounded-lg p-2"><option value={100}>۱۰۰٪</option><option value={150}>۱۵۰٪</option><option value={200}>۲۰۰٪</option></select></label>{error?<p role="alert" className="text-xs text-red-700">تصویر قابل نمایش نیست.</p>:<div dir="ltr" className="max-w-full overflow-auto bg-slate-100 rounded-lg">{url&&<img src={url} alt="اصل تصویر پیوست" onError={()=>setError(true)} className="block max-w-none h-auto mx-auto" style={{width:zoom+'%'}}/>}</div>}</div>;
}
function OpenAttachment({id,mime}:{id:string;mime:string}){
 const [content,setContent]=useState<PreviewContent|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let stopped=false;
  readAttachmentPreview(androidAttachments,id,mime).then(value=>{if(!stopped)setContent(value);}).catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'خواندن اصل سند ناموفق بود.');});
  return ()=>{stopped=true;};
 },[id,mime]);
 if(error)return <p role="alert" className="text-xs text-red-700">{error}</p>;
 if(!content)return <p role="status" className="text-xs">در حال خواندن فایل اصلی…</p>;
 if(content.kind==='image')return <ImagePreview blob={content.blob}/>;
 if(content.kind==='text')return <div><pre dir="auto" className="whitespace-pre-wrap break-all max-h-96 overflow-auto text-xs border p-3 rounded-lg">{content.text}</pre>{content.truncated&&<p className="mt-2 text-xs text-slate-600">فقط ابتدای فایل (۲۵۶ کیلوبایت) نمایش داده می‌شود. برای متن کامل، اصل فایل را ذخیره کنید.</p>}</div>;
 return <Suspense fallback={<p role="status" className="text-xs">در حال آماده‌سازی نمایشگر PDF…</p>}><PdfPreview bytes={content.bytes}/></Suspense>;
}
export function AttachmentViewer({id,mime,name,open,onToggle}:{id:string;mime:string;name?:string;open:boolean;onToggle:()=>void}){
 if(!isAndroidRuntime())return null;
 return <div className="space-y-2 min-w-0">
 <button type="button" onClick={onToggle} aria-expanded={open} className="min-h-11 rounded-lg bg-teal-700 text-white text-xs font-semibold px-3">{open?'بستن نمایش فایل اصلی':'مشاهده فایل اصلی در حساب‌یار'}</button>
 {open&&<div className="border rounded-xl bg-white p-2 space-y-2 min-w-0"><p className="text-xs font-semibold break-all">{name??'فایل اصلی'}</p><OpenAttachment key={id+':'+mime} id={id} mime={mime}/></div>}
 </div>;
}
