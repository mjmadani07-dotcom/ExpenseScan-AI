// Only opaque scope identity and navigation flags. No amounts, names, file
// names, bytes, attachment digests, credentials or financial content.
export type PickerKind='camera'|'image'|'pdf'|'text';
export type CaptureCheckpoint={version:1;scope:string;picker:PickerKind|null};
const KEY='hesabyar_capture_route_v1';
export const SINGLE_SCOPE='single';
export function parseCaptureCheckpoint(raw:string|null):CaptureCheckpoint|null{
 try{
  if(!raw)return null;const v=JSON.parse(raw);
  if(!v||v.version!==1||typeof v.scope!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v.scope)||!(v.picker===null||['camera','image','pdf','text'].includes(v.picker))||Object.keys(v).some(k=>!['version','scope','picker'].includes(k)))return null;
  return {version:1,scope:v.scope,picker:v.picker};
 }catch{return null;}
}
export function readCaptureCheckpoint(){try{return parseCaptureCheckpoint(localStorage.getItem(KEY));}catch{return null;}}
export function markCapture(scope:string,picker:PickerKind|null=null){
 const v=parseCaptureCheckpoint(JSON.stringify({version:1,scope,picker}));if(!v)return;
 try{localStorage.setItem(KEY,JSON.stringify(v));}catch{/* Drafts remain in encrypted native DB. */}
}
export function clearCapture(scope:string){try{if(readCaptureCheckpoint()?.scope===scope)localStorage.removeItem(KEY);}catch{}}
