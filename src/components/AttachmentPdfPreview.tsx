import React,{useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {boundedPdfScale} from '../utils/attachmentPreview';
import {toPersianDigits} from '../utils/jalali';

GlobalWorkerOptions.workerSrc=workerUrl;
function PdfPage({document,page,zoom}:{document:PDFDocumentProxy;page:number;zoom:number}){
 const ref=useRef<HTMLCanvasElement>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  let stopped=false;let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
  const canvas=ref.current;
  void (async()=>{
   try{
    if(!canvas)throw Error();
    const p=await document.getPage(page);if(stopped)return;
    const base=p.getViewport({scale:1}),viewport=p.getViewport({scale:boundedPdfScale(base.width,base.height)});
    canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
    const context=canvas.getContext('2d');if(!context)throw Error();
    task=p.render({canvasContext:context,viewport,canvas});await task.promise;
    if(!stopped){p.cleanup();setBusy(false);}
   }catch{if(!stopped){setBusy(false);setError('نمایش این صفحه ممکن نیست. اصل فایل را در صورت نیاز جداگانه ذخیره کنید.');}}
  })();
  return ()=>{stopped=true;task?.cancel();if(canvas){canvas.width=0;canvas.height=0;}};
 },[document,page]);
 return <div className="space-y-2">{busy&&<p role="status" className="text-xs">در حال نمایش صفحه…</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}<div dir="ltr" className="max-w-full overflow-auto bg-slate-100 rounded-lg"><canvas ref={ref} aria-label={'صفحه '+toPersianDigits(page)} className={busy||error?'hidden':'block max-w-none mx-auto bg-white'} style={{width:zoom+'%',height:'auto'}}/></div></div>;
}
export default function AttachmentPdfPreview({bytes}:{bytes:Uint8Array<ArrayBuffer>}){
 const [doc,setDoc]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(100),[error,setError]=useState('');
 useEffect(()=>{
  let stopped=false;
  // Render canvas only: no links, scripting, annotations, or external document navigation.
  const loading=getDocument({data:bytes.slice(),isEvalSupported:false,enableXfa:false,useSystemFonts:true,stopAtErrors:true,maxImageSize:16_000_000});
  loading.promise.then(value=>{if(!stopped)setDoc(value);}).catch(()=>{if(!stopped)setError('PDF آسیب‌دیده، دارای رمز یا غیرقابل نمایش است.');});
  return ()=>{stopped=true;void loading.destroy().catch(()=>{});};
 },[bytes]);
 if(error)return <p role="alert" className="text-xs text-red-700">{error}</p>;
 if(!doc)return <p role="status" className="text-xs">در حال باز کردن PDF…</p>;
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2 items-center justify-between text-xs">
   <button type="button" disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))} className="min-h-10 border rounded-lg px-3 disabled:opacity-40">صفحه قبل</button>
   <span>صفحه {toPersianDigits(page)} از {toPersianDigits(doc.numPages)}</span>
   <button type="button" disabled={page>=doc.numPages} onClick={()=>setPage(v=>Math.min(doc.numPages,v+1))} className="min-h-10 border rounded-lg px-3 disabled:opacity-40">صفحه بعد</button>
   <label className="flex items-center gap-1">بزرگ‌نمایی <select value={zoom} onChange={e=>setZoom(Number(e.target.value))} className="border rounded-lg p-2"><option value={100}>۱۰۰٪</option><option value={150}>۱۵۰٪</option><option value={200}>۲۰۰٪</option></select></label>
  </div>
  <PdfPage key={page} document={doc} page={page} zoom={zoom}/>
 </div>;
}
