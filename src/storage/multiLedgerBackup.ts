import {cleanBackupManifest} from './portableBackup';
import {validateMultiLedger,multiLedgerAttachmentIds,type MultiLedgerState} from './multiLedger';
import {type AttachmentStore} from './attachments';
import {writeFramedBackup,readFramedBackup,previewFramedBackup,hasFramedMagic,type FramedBackupFormat,type ByteSink,type Progress} from './streamBackup';

const MAGIC=new TextEncoder().encode('ESBACK3\n');
// Portable v3 contains all ledgers and their recovery checkpoints, never device AI
// configuration or replay acknowledgement tokens. Keep identities and archive flags.
export function cleanMultiLedgerBackup(input:unknown):MultiLedgerState{
 const root=validateMultiLedger(input);
 return {version:1,workspaces:root.workspaces.map(({profile,state})=>{
  if(profile.archived&&state.draft)throw new Error('دفتر بایگانی‌شده دارای پیش‌نویس است.');
  const current=cleanBackupManifest(state);
  const recoveries=(state.recoveries??[]).map(({id,createdAt,ledger,draft})=>({id,createdAt,...cleanBackupManifest({ledger,draft})}));
  return {profile,state:{...current,recoveries}};
 })};
}
const format:FramedBackupFormat<MultiLedgerState>={magic:MAGIC,clean:cleanMultiLedgerBackup,ids:multiLedgerAttachmentIds};
export const isMultiLedgerBackup=(file:Blob)=>hasFramedMagic(file,MAGIC);
export const writeMultiLedgerBackup=(root:MultiLedgerState,password:string,store:Pick<AttachmentStore,'get'>|undefined,sink:ByteSink,progress?:Progress,signal?:AbortSignal)=>writeFramedBackup(format,root,password,store,sink,progress,signal);
export const previewMultiLedgerBackup=(file:Blob,password:string,signal?:AbortSignal)=>previewFramedBackup(format,file,password,signal);
// Stages only content-addressed immutable attachments. No database mutation here.
// Callers must commit the returned manifest in a separate atomic transaction,
// after the terminator and all attachment digests have been verified.
export const readMultiLedgerBackup=(file:Blob,password:string,store:Pick<AttachmentStore,'put'>|undefined,progress?:Progress,signal?:AbortSignal)=>readFramedBackup(format,file,password,store,progress,signal);
