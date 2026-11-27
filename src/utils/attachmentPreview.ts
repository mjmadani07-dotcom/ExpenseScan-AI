import { ATTACHMENT_MIMES,MAX_ATTACHMENT_BYTES,decodeBytes,verifyAttachment,type AttachmentStore } from '../storage/attachments';

export const TEXT_PREVIEW_BYTES=256*1024;
export type PreviewContent=
 |{kind:'pdf';bytes:Uint8Array<ArrayBuffer>}
 |{kind:'image';blob:Blob}
 |{kind:'text';text:string;truncated:boolean};

function signature(bytes:Uint8Array,offset:number,ascii:string){
 return bytes.length>=offset+ascii.length&&Array.from(ascii).every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
}
export function identifyPreview(bytes:Uint8Array<ArrayBuffer>,mime:string):PreviewContent{
 if(bytes.length===0||bytes.length>MAX_ATTACHMENT_BYTES||!ATTACHMENT_MIMES.includes(mime as typeof ATTACHMENT_MIMES[number]))throw new Error('نوع یا حجم پیوست برای نمایش داخلی معتبر نیست.');
 if(mime==='text/plain'||mime==='text/csv')return {kind:'text',text:new TextDecoder().decode(bytes.subarray(0,TEXT_PREVIEW_BYTES)),truncated:bytes.length>TEXT_PREVIEW_BYTES};
 if(mime==='application/pdf'){
  let valid=false;
  for(let i=0;i<Math.min(1024,bytes.length);i++)if(signature(bytes,i,'%PDF-')){valid=true;break;}
  if(!valid)throw new Error('محتوای فایل با نوع PDF مطابقت ندارد.');
  return {kind:'pdf',bytes};
 }
 const valid=mime==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  :mime==='image/png'?signature(bytes,1,'PNG')&&bytes[0]===137&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10
  :mime==='image/gif'?signature(bytes,0,'GIF87a')||signature(bytes,0,'GIF89a')
  :mime==='image/webp'?signature(bytes,0,'RIFF')&&signature(bytes,8,'WEBP'):false;
 if(!valid)throw new Error('محتوای فایل با نوع تصویر ثبت‌شده مطابقت ندارد.');
 return {kind:'image',blob:new Blob([bytes],{type:mime})};
}
export async function readAttachmentPreview(store:Pick<AttachmentStore,'get'>,id:string,mime:string){
 const data=await store.get(id);
 await verifyAttachment(id,data);
 return identifyPreview(decodeBytes(data),mime);
}
// Bound the rendering surface, including unusually wide/tall document pages.
export function boundedPdfScale(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('اندازه صفحه PDF معتبر نیست.');
 const scale=Math.min(3,2400/Math.max(width,height),Math.sqrt(4_000_000/(width*height)));
 if(!Number.isFinite(scale)||scale<=0||width*scale<1||height*scale<1)throw new Error('اندازه صفحه PDF قابل نمایش نیست.');
 return scale;
}
