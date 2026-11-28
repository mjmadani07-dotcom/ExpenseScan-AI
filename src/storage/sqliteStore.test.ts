import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExpenseFields } from '../types/expense';
import { SqliteSnapshotStore,type SqliteDriver,type SqliteExecutor,type SqlValue } from './sqliteStore';
import { LocalLedgerRepository } from './localLedgerRepository';
import { WebLedgerRepository } from './ledgerRepository';

function driver(db:DatabaseSync):SqliteDriver {
  const exec:SqliteExecutor={
    async query<T>(sql:string,params:SqlValue[]=[]){return db.prepare(sql).all(...params) as T[];},
    async run(sql:string,params:SqlValue[]=[]){return {changes:Number(db.prepare(sql).run(...params).changes)};}
  };
  return {...exec,async transaction<T>(fn:(tx:SqliteExecutor)=>Promise<T>){db.exec('BEGIN IMMEDIATE');try{const value=await fn(exec);db.exec('COMMIT');return value;}catch(err){db.exec('ROLLBACK');throw err;}}};
}
const expense:ExpenseFields={title:'Test',vendor:'Vendor',documentType:'invoice',category:'operations',costCenter:'general',amount:12345,currency:'IRR',taxAmount:0,discountAmount:0,date:'2026-11-27',paymentMethod:'cash',paymentStatus:'paid',lineItems:[],sourceType:'text'};
test('SQLite local repository persists CRUD, categories, settings and draft across reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'expensescan-'));const path=join(dir,'ledger.sqlite');
  let db=new DatabaseSync(path);
  try{
    let repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)));await repo.initialize();
    assert.deepEqual((await repo.load()).expenses,[]);
    const draft={id:'draft1',drafts:[{...expense,tempId:'tmp',selected:true}],previewPages:[]};
    await repo.saveDraft(draft);
    db.close();db=new DatabaseSync(path);
    repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)));await repo.initialize();
    assert.deepEqual(await repo.loadDraft(),draft);
    const [created]=await repo.add([expense],'draft1');
    assert.equal(await repo.loadDraft(),null);
    assert.equal((await repo.add([expense],'draft1'))[0].id,created.id);
    assert.equal((await repo.load()).expenses.length,1);
    await repo.update(created.id,{amount:12346});
    await assert.rejects(()=>repo.update(created.id,{amount:-2}),/نامعتبر/);
    const cat=await repo.addCategory({label:'New category',color:'#123456',monthlyLimitIRT:100});
    await repo.update(created.id,{category:cat.category.id});
    await repo.deleteCategory(cat.category.id,'operations');
    await repo.settings([{category:'operations',monthlyLimitIRT:456}],{USD:71000,EUR:78000},{provider:'openai',model:'gpt-4o-mini'});
    db.close();db=new DatabaseSync(path);
    repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)));await repo.initialize();
    const persisted=await repo.load();
    assert.equal(persisted.expenses[0].amount,12346);
    assert.equal(persisted.expenses[0].currency,'IRR');
    assert.equal(persisted.expenses[0].category,'operations');
    assert.equal(persisted.rates.USD,71000);
    await repo.remove(created.id);
    assert.deepEqual((await repo.load()).expenses,[]);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('SQLite invalid import and stale revision cannot overwrite committed data',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const store=new SqliteSnapshotStore(driver(db));const repo=new LocalLedgerRepository(store);await repo.initialize();
    const old=await store.read();
    await repo.add([expense]);
    await assert.rejects(()=>repo.import([{...expense,amount:'bad'}],'replace'),/نامعتبر/);
    assert.equal((await repo.load()).expenses.length,1);
    assert.equal(await store.compareAndSwap(old.revision,old.state),false);
    assert.equal((await repo.load()).expenses.length,1);
    db.exec("UPDATE ledger_state SET payload='broken'");
    await assert.rejects(()=>repo.initialize());
    assert.equal(db.prepare('SELECT payload FROM ledger_state').get()?.payload,'broken');
  }finally{db.close();}
});
test('SQLite rejects unsupported schema without resetting existing data',async()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec('PRAGMA user_version=99');
    await assert.rejects(()=>new SqliteSnapshotStore(driver(db)).initialize(),/پشتیبانی/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,99);
  }finally{db.close();}
});
test('Web adapter propagates failed mutations instead of pretending to save',async()=>{
  const repo=new WebLedgerRepository(async()=>new Response(JSON.stringify({error:'denied'}),{status:400}));
  await assert.rejects(()=>repo.update('id',{amount:1}),/denied/);
  await assert.rejects(()=>repo.remove('id'),/denied/);
  const offline=new WebLedgerRepository(async()=>{throw new TypeError('offline');});
  await assert.rejects(()=>offline.add([expense]),/ارتباط/);
});

test('Web transport omits optional undefined fields on create and sends explicit null only for cleared patch fields',async()=>{
  const sent:unknown[]=[];
  const repo=new WebLedgerRepository(async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({created:[{...expense,id:'a'}],expense:{...expense,id:'a'}}),{status:200});});
  await repo.add([{...expense,notes:undefined}]);
  assert.equal(Object.hasOwn((sent[0] as any).expenses[0],'notes'),false);
  await repo.update('a',{notes:undefined,paymentTranches:[{id:'t',title:'T',amount:1,method:'cash',status:'pending',date:undefined}]});
  assert.equal((sent[1] as any).notes,null);
  assert.equal(Object.hasOwn((sent[1] as any).paymentTranches[0],'date'),false);
});

test('Android bridge uses exact revision string, validates snapshots and fails closed',async()=>{
  const {AndroidSnapshotStore}=await import('./androidSnapshotStore');
  const global=globalThis as any;
  const previous=global.Capacitor;
  try {
    let payload='',rev=0,schema=2;const rows=new Map<string,any>();const patches:any[]=[];
    global.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{
      async initialize(v:any){if(!payload)payload=v.initialPayload;},
      async read(v:any){const scope=v?.scope??'all';return schema===2?{revision:rev,schema,payload}:{revision:rev,schema,scope,rows:JSON.stringify([...rows.values()].filter(x=>scope!=='active'||!['recoveries','approval'].includes(x.table)))};},
      async commitRows(v:any){assert.equal(typeof v.revision,'string');if(v.revision!==String(rev))return {committed:false};const patch=JSON.parse(v.patch);patches.push(patch);for(const x of patch.deletes)rows.delete(JSON.stringify([x.table,x.id]));for(const x of patch.upserts)rows.set(JSON.stringify([x.table,x.id]),x);schema=3;rev++;return {committed:true};}
    }}};
    const store=new AndroidSnapshotStore();await store.initialize();
    const repo=new LocalLedgerRepository(store);
    const [created]=await repo.add([expense]);assert.equal((await repo.load()).expenses[0].amount,12345);
    assert.equal(schema,3);await repo.update(created.id,{amount:12346});assert.deepEqual(patches.at(-1).upserts.map((x:any)=>x.table),['expenses']);
    assert.equal((await repo.load()).expenses[0].amount,12346);
    global.Capacitor={getPlatform:()=> 'android'};
    await assert.rejects(()=>store.read(),/اندروید/);
  } finally {if(previous===undefined)delete global.Capacitor;else global.Capacitor=previous;}
});

test('encrypted portable backup rejects wrong passwords and tampering; excludes AI configuration',async()=>{
 const {encryptBackup,decryptBackup}=await import('./portableBackup');
 const db=new DatabaseSync(':memory:');try{
 const repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)));await repo.initialize();await repo.add([expense]);
 const snapshot=await repo.exportBackup();const text=await encryptBackup(snapshot,'a strong test password');
 assert.equal(text.includes('Vendor'),false);
 const restored=await decryptBackup(text,'a strong test password');assert.equal(restored.ledger.expenses[0].amount,12345);assert.equal(restored.ledger.aiConfig,undefined);
 await assert.rejects(()=>decryptBackup(text,'wrong password'),/گذرواژه/);
 const broken=JSON.parse(text);broken.ciphertext=(broken.ciphertext[0]==='A'?'B':'A')+broken.ciphertext.slice(1);
 await assert.rejects(()=>decryptBackup(JSON.stringify(broken),'a strong test password'),/گذرواژه/);
 await repo.clear('all');assert.equal((await repo.load()).expenses.length,0);assert.equal((await repo.recoveryInfo())?.count,1);
 await repo.restoreRecovery();assert.equal((await repo.load()).expenses.length,1);
 await repo.clear('all');await repo.restoreBackup(restored);assert.equal((await repo.load()).expenses.length,1);
 }finally{db.close();}
});

test('recovery archive keeps three versions, restores by ID and deletes only selected checkpoint',async()=>{
 const db=new DatabaseSync(':memory:');try{
 const repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)));await repo.initialize();
 await repo.createRecovery();
 const empty=(await repo.recoveryList())[0];
 await repo.add([expense]);await repo.createRecovery();
 const one=(await repo.recoveryList())[0];
 await repo.add([{...expense,title:'second'}]);await repo.createRecovery();
 await repo.add([{...expense,title:'third'}]);await repo.createRecovery();
 const archive=await repo.recoveryList();assert.equal(archive.length,3);assert.equal(archive.some(x=>x.id===empty.id),false);
 await repo.deleteRecovery(archive[1].id);assert.equal((await repo.recoveryList()).length,2);
 assert.equal((await repo.load()).expenses.length,3);
 await repo.restoreRecovery(one.id);assert.equal((await repo.load()).expenses.length,1);
 assert.equal((await repo.recoveryList())[0].count,3);
 await assert.rejects(()=>repo.deleteRecovery('missing'),/یافت نشد/);
 }finally{db.close();}
});
test('legacy single recovery is preserved in multi-version archive',async()=>{
 const db=new DatabaseSync(':memory:');try{
 const store=new SqliteSnapshotStore(driver(db));await store.initialize();
 const row=await store.read();const legacy={...row.state,recoveries:undefined,recovery:{createdAt:'2026-11-27T00:00:00Z',ledger:row.state.ledger,draft:null}};
 db.prepare('UPDATE ledger_state SET payload=? WHERE id=1').run(JSON.stringify(legacy));
 const repo=new LocalLedgerRepository(store);
 assert.equal((await repo.recoveryList()).length,1);
 await repo.createRecovery();assert.equal((await repo.recoveryList()).length,2);
 }finally{db.close();}
});

test('native export normalizes Persian filename digits and preserves binary data',async()=>{
 const {nativeExportFile}=await import('./androidSnapshotStore');
 const g=globalThis as any, previous=g.Capacitor;let received:any;
 try{
 g.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{async saveExportFile(v:any){received=v;}}}};
 await nativeExportFile('hesabyar-۱۴۰۵-۰۹-۰۶.xlsx',new Uint8Array([0,255,128,65]),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.equal(received.name,'hesabyar-1405-09-06.xlsx');
 assert.deepEqual(Array.from(Uint8Array.from(atob(received.data),c=>c.charCodeAt(0))),[0,255,128,65]);
 }finally{if(previous===undefined)delete g.Capacitor;else g.Capacitor=previous;}
});

test('separate attachment store preserves originals and full encrypted backup roundtrip',async()=>{
 const {encodeBytes,digestBytes}=await import('./attachments');const {encryptBackup,decryptBackup}=await import('./portableBackup');
 const bytes=new Uint8Array([37,80,68,70,45,0,255]);const id=await digestBytes(bytes),data=encodeBytes(bytes);
 const makeStore=()=>{const map=new Map<string,string>();return {map,async put(id:string,data:string){map.set(id,data);},async get(id:string){const d=map.get(id);if(!d)throw new Error('missing attachment');return d;}};};
 const db1=new DatabaseSync(':memory:'),db2=new DatabaseSync(':memory:');try{
 const files=makeStore(),otherFiles=makeStore();await files.put(id,data);
 const repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db1)),files);await repo.initialize();
 const record=(await repo.add([{...expense,sourceType:'pdf',sourceFileName:'invoice.pdf',attachmentId:id,attachmentMime:'application/pdf'}]))[0];
 const persisted=(await repo.load()).expenses[0];assert.equal(persisted.attachmentId,id);assert.equal(JSON.stringify(await repo.load()).includes(data),false);
 const backup=await repo.exportBackup();assert.equal(backup.attachments?.[id],data);
 const enc=await encryptBackup(backup,'test strong password 123');
 const decoded=await decryptBackup(enc,'test strong password 123');
 const second=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db2)),otherFiles);await second.initialize();await second.restoreBackup(decoded);
 assert.equal(otherFiles.map.get(id),data);assert.equal((await second.load()).expenses[0].id,record.id);
 await assert.rejects(()=>second.restoreBackup({...decoded,attachments:{[id]:encodeBytes(new Uint8Array([99]))}}),/یکپارچگی/);
 assert.equal((await second.load()).expenses.length,1);
 await assert.rejects(()=>repo.add([{...expense,attachmentId:'a'.repeat(64),attachmentMime:'application/pdf'}]));
 }finally{db1.close();db2.close();}
});

test('partitioned ledger preserves order, line items, installments, settings and recovery with exact roundtrip',async()=>{
 const {partitionLedger,assembleLedger,canonicalJson,diffLedgerRows}=await import('./ledgerRows');
 const {emptyLedger}=await import('./ledgerDomain');
 const {decodeStoredState}=await import('./sqliteStore');
 const ledger=emptyLedger(),date='2026-11-27T00:00:00Z';
 const record={...expense,id:'legacy-document',createdAt:date,approvedAt:date,lineItems:[{description:'item',quantity:2,unitPrice:100,totalPrice:200}],paymentTranches:[{id:'p1',title:'part',amount:100,method:'cash' as const,status:'paid' as const}]};
 ledger.expenses=[record,{...record,id:'second'}];
 const before=decodeStoredState(JSON.stringify({ledger,draft:null,recoveries:[{id:'r1',createdAt:date,ledger,draft:null}]}));
 const rows=partitionLedger(before);assert.equal(canonicalJson(assembleLedger(rows)),canonicalJson(before));
 const next=structuredClone(before);next.ledger.expenses[0].lineItems[0].description='changed';
 const patch=diffLedgerRows(rows,partitionLedger(next));assert.deepEqual(patch.upserts.map(x=>x.table),['line_items']);assert.equal(patch.deletes.length,0);
 assert.throws(()=>assembleLedger(rows.filter(r=>r.table!=='line_items')),/نامعتبر/);
 assert.throws(()=>assembleLedger([...rows,rows[0]]),/نامعتبر/);
 assert.throws(()=>assembleLedger(rows.map(r=>r.table==='line_items'?{...r,parent:'incorrect'}:r)),/نامعتبر/);
});
test('row changes preserve independent recovery snapshots and remove dependent children only',async()=>{
 const {partitionLedger,diffLedgerRows,assembleLedger}=await import('./ledgerRows');
 const {emptyLedger}=await import('./ledgerDomain');
 const date='2026-11-27T00:00:00Z',ledger=emptyLedger();
 ledger.expenses=[{...expense,id:'one',createdAt:date,approvedAt:date,lineItems:[{description:'item',quantity:1,unitPrice:100,totalPrice:100}]}];
 const before={ledger,draft:null,recoveries:[{id:'old',createdAt:date,ledger:structuredClone(ledger),draft:null}]};
 const after=structuredClone(before);after.ledger.expenses=[];
 const old=partitionLedger(before),next=partitionLedger(after),patch=diffLedgerRows(old,next);
 assert.deepEqual(patch.deletes.map(x=>x.table),['expenses','line_items']);assert.deepEqual(patch.upserts.map(x=>x.table),['meta']);
 assert.equal(assembleLedger(next).recoveries![0].ledger.expenses.length,1);
});

test('attachment inventory protects recovery-only and draft-only references and detects missing files',async()=>{
 const {auditAttachmentInventory}=await import('./attachments');const {emptyLedger}=await import('./ledgerDomain');
 const date='2026-11-27T00:00:00Z',a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64);
 const record=(id:string,attachmentId:string)=>({...expense,id,createdAt:date,approvedAt:date,attachmentId,attachmentMime:'application/pdf'});
 const ledger=emptyLedger();ledger.expenses=[record('active',a)];
 const recovery=emptyLedger();recovery.expenses=[record('recovered',b)];
 const draft={id:'draft',drafts:[{...expense,tempId:'draft-item',selected:true,attachmentId:c,attachmentMime:'application/pdf'}],previewPages:[]};
 const audit=auditAttachmentInventory([{id:a,storedBytes:10},{id:b,storedBytes:20},{id:d,storedBytes:40}],{ledger,draft,recoveries:[{id:'r',createdAt:date,ledger:recovery,draft:null}]});
 assert.deepEqual(audit,{referenced:3,missing:1,unreferenced:1,unreferencedBytes:40,storedBytes:70});
});

test('AI connection probe uses only synthetic data and respects custom endpoint and secure transport',async()=>{
 const {testAiConnection}=await import('../utils/clientAiExtract');
 const previous=globalThis.fetch;let count=0;
 try{
 globalThis.fetch=async(url,init)=>{count++;assert.equal(String(url),'https://example.invalid/v1/chat/completions');assert.equal(init?.redirect,'error');const headers=init?.headers as Record<string,string>;assert.equal(headers.Authorization,'Bearer dummy-test');const body=String(init?.body);assert.match(body,/SYNTHETIC CONNECTION TEST ONLY/);assert.match(body,/test-model/);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({expenses:[{title:'Test receipt',vendor:'Test Vendor',amount:10000,currency:'IRR',date:'2026-11-27',paymentMethod:'cash',paymentStatus:'paid'}]})}}]}),{status:200});};
 const params={provider:'openai' as const,model:'test-model',apiKey:'dummy-test',baseUrl:'https://example.invalid/v1',secureTransport:true};
 assert.equal((await testAiConnection(params)).count,1);assert.equal(count,1);
 await assert.rejects(()=>testAiConnection({...params,baseUrl:'http://example.invalid/v1'}),/HTTPS/);assert.equal(count,1);
 globalThis.fetch=async()=>new Response('secret echoed from remote service',{status:400});
 await assert.rejects(()=>testAiConnection(params),e=>e instanceof Error&&!e.message.includes('secret echoed')&&e.message.includes('400'));
 }finally{globalThis.fetch=previous;}
});

test('Android authentication bridge selects explicit biometric or system credential entry',async()=>{
 const {nativeUnlock,nativeSessionStatus}=await import('./androidSnapshotStore');
 const g=globalThis as any,previous=g.Capacitor;const calls:string[]=[];
 try{g.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{async unlockApp(){calls.push('credential');},async unlockBiometric(){calls.push('biometric');},async sessionStatus(){return {unlocked:false,deviceSecure:true,biometricAvailable:true};}}}};
 assert.equal((await nativeSessionStatus()).biometricAvailable,true);await nativeUnlock(true);await nativeUnlock();assert.deepEqual(calls,['biometric','credential']);
 }finally{if(previous===undefined)delete g.Capacitor;else g.Capacitor=previous;}
});

test('cleanup bridge passes only exact committed revision, not a client orphan list',async()=>{
 const {androidAttachments}=await import('./androidSnapshotStore');
 const g=globalThis as any,previous=g.Capacitor;let call:unknown;
 try{g.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{async cleanupAttachments(v:unknown){call=v;return {removed:1,releasedBytes:100,failed:0,skipped:2};}}}};
 const result=await androidAttachments.cleanup!(17);assert.deepEqual(call,{revision:'17'});assert.equal(result.removed,1);
 await assert.rejects(()=>androidAttachments.cleanup!(-1),/نامعتبر/);
 }finally{if(previous===undefined)delete g.Capacitor;else g.Capacitor=previous;}
});

test('stream backup authenticates ordered frames, stages attachments separately, rejects tampering and truncated terminator',async()=>{
 const {writeStreamBackup,readStreamBackup,previewStreamBackup,isStreamBackup}=await import('./streamBackup');
 const {encodeBytes,digestBytes}=await import('./attachments');
 const {emptyLedger}=await import('./ledgerDomain');
 const raw=new Uint8Array([37,80,68,70,45,0,255]),id=await digestBytes(raw),data=encodeBytes(raw),date='2026-11-27T00:00:00Z';
 const ledger=emptyLedger();ledger.expenses=[{...expense,id:'one',createdAt:date,approvedAt:date,attachmentId:id,attachmentMime:'application/pdf'}];
 const chunks:Uint8Array<ArrayBuffer>[]=[];const pass='test long password 123';
 const size=await writeStreamBackup({ledger,draft:null},pass,{async get(){return data;}},async b=>{chunks.push(b);});
 const file=new Blob(chunks);assert.equal(file.size,size);assert.equal(await isStreamBackup(file),true);
 const preview=await previewStreamBackup(file,pass);assert.equal(preview.attachmentCount,1);assert.equal(preview.manifest.ledger.aiConfig,undefined);
 const writes=new Map<string,string>();const store={async put(k:string,v:string){writes.set(k,v);}};
 const restored=await readStreamBackup(file,pass,store);assert.equal(restored.ledger.expenses[0].id,'one');assert.equal(writes.get(id),data);
 await assert.rejects(()=>previewStreamBackup(file,'wrong password'));
 await assert.rejects(()=>readStreamBackup(file.slice(0,file.size-1),pass,store));
 await assert.rejects(()=>readStreamBackup(new Blob([file,new Uint8Array([1])]),pass,store));
 const corrupt=new Uint8Array(await file.arrayBuffer());corrupt[corrupt.length-1]^=1;await assert.rejects(()=>readStreamBackup(new Blob([corrupt]),pass,store));
 const db=new DatabaseSync(':memory:');try{
 const repo=new LocalLedgerRepository(new SqliteSnapshotStore(driver(db)),{...store,async get(k){const d=writes.get(k);if(!d)throw Error('missing');return d;}});
 await repo.initialize();await repo.add([expense]);const before=await repo.load();
 await assert.rejects(()=>repo.restoreStreamBackup(file.slice(0,file.size-1),pass));assert.deepEqual(await repo.load(),before);
 await repo.restoreStreamBackup(file,pass);assert.equal((await repo.load()).expenses[0].id,'one');
 }finally{db.close();}
});


test('stream backup exceeds legacy aggregate capacity without aggregating original files',async()=>{
 const {writeStreamBackup,readStreamBackup}=await import('./streamBackup');
 const {encodeBytes,digestBytes}=await import('./attachments');
 const {emptyLedger}=await import('./ledgerDomain');
 const {openAsBlob}=await import('node:fs');const {open}=await import('node:fs/promises');
 const bytesPerFile=9*1024*1024,date='2026-11-27T00:00:00Z',ledger=emptyLedger();
 const make=(i:number)=>{const a=new Uint8Array(bytesPerFile);a[0]=i+1;a[a.length-1]=255-i;return a;};
 const ids:string[]=[];for(let i=0;i<4;i++){const id=await digestBytes(make(i));ids.push(id);ledger.expenses.push({...expense,id:'large-'+i,createdAt:date,approvedAt:date,attachmentId:id,attachmentMime:'application/pdf'});}
 const dir=mkdtempSync(join(tmpdir(),'expensescan-stream-')),path=join(dir,'large.esbackup2'),handle=await open(path,'w');
 try{
  let maxFrame=0;const progress:number[]=[];const pass='test long password 123';
  const size=await writeStreamBackup({ledger,draft:null},pass,{async get(id){return encodeBytes(make(ids.indexOf(id)));}},async bytes=>{maxFrame=Math.max(maxFrame,bytes.length);let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset);if(!result.bytesWritten)throw Error('short write');offset+=result.bytesWritten;}},p=>progress.push(p.done));
  await handle.close();
  assert.ok(size>32*1024*1024);assert.ok(maxFrame<=bytesPerFile+16);assert.deepEqual(progress,[0,1,2,3,4]);
  const restoredIds:string[]=[];const file=await openAsBlob(path);
  const restored=await readStreamBackup(file,pass,{async put(id,data){const {verifyAttachment}=await import('./attachments');await verifyAttachment(id,data);restoredIds.push(id);}});
  assert.equal(restored.ledger.expenses.length,4);assert.deepEqual(restoredIds,ids.slice().sort());
 }finally{await handle.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
test('native stream backup staging splits binary data into bounded chunks and discards on failure',async()=>{
 const {nativeWriteStreamBackup}=await import('./androidSnapshotStore');
 const g=globalThis as any,previous=g.Capacitor;const calls:string[]=[];const lens:number[]=[];
 try{
 g.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{async beginStreamBackup(){calls.push('begin');return {token:'stage'};},async appendStreamBackup(v:any){assert.equal(v.token,'stage');lens.push(atob(v.data).length);},async finishStreamBackup(v:any){calls.push('finish');assert.equal(v.name,'ExpenseScan.esbackup2');},async discardStreamBackup(){calls.push('discard');}}}};
 await nativeWriteStreamBackup('ExpenseScan.esbackup2',async sink=>{await sink(new Uint8Array(2*1048576+3));return 2*1048576+3;});
 assert.deepEqual(lens,[1048576,1048576,3]);assert.deepEqual(calls,['begin','finish','discard']);
 calls.length=0;await assert.rejects(()=>nativeWriteStreamBackup('ExpenseScan.esbackup2',async()=>{throw Error('failed');}),/failed/);assert.deepEqual(calls,['begin','discard']);
 }finally{if(previous===undefined)delete g.Capacitor;else g.Capacitor=previous;}
});


test('active-only read omits recovery payloads and approval without altering full writes',async()=>{
 const {AndroidSnapshotStore}=await import('./androidSnapshotStore');
 const {partitionLedger}=await import('./ledgerRows');const {emptyLedger}=await import('./ledgerDomain');
 const date='2026-11-27T00:00:00Z',ledger=emptyLedger();
 const created={...expense,id:'doc',createdAt:date,approvedAt:date};
 ledger.expenses=[created];
 const original=partitionLedger({ledger,draft:null,lastApproval:{id:'draft',records:[created]},recoveries:[{id:'r',createdAt:date,ledger:structuredClone(ledger),draft:null}]});
 const g=globalThis as any,previous=g.Capacitor;let rev=7;const scopes:string[]=[];const rows=new Map(original.map(r=>[JSON.stringify([r.table,r.id]),r]));
 try{
 g.Capacitor={getPlatform:()=> 'android',Plugins:{LedgerStorage:{async initialize(){},async read({scope}:any){scopes.push(scope);return {revision:rev,schema:3,scope,rows:JSON.stringify([...rows.values()].filter(x=>scope==='all'||!['recoveries','approval'].includes(x.table)))};},async commitRows(v:any){assert.equal(v.revision,String(rev));const p=JSON.parse(v.patch);for(const x of p.deletes)rows.delete(JSON.stringify([x.table,x.id]));for(const x of p.upserts)rows.set(JSON.stringify([x.table,x.id]),x);rev++;return {committed:true};}}}};
 const repo=new LocalLedgerRepository(new AndroidSnapshotStore());await repo.initialize();const active=await repo.loadActive();assert.equal(active.ledger.expenses.length,1);assert.deepEqual(scopes,['active','active']);
 await repo.update('doc',{amount:20000});assert.equal(scopes.at(-1),'all');assert.equal(rows.get(JSON.stringify(['recoveries','r']))?.data,original.find(x=>x.table==='recoveries')?.data);
 assert.equal(rows.get(JSON.stringify(['approval','last']))?.data,original.find(x=>x.table==='approval')?.data);
 assert.equal((await repo.load()).expenses[0].amount,20000);
 }finally{if(previous===undefined)delete g.Capacitor;else g.Capacitor=previous;}
});
test('large ledger active projection preserves 3000 documents, amounts and ordering without archive payloads',async()=>{
 const {partitionLedger,assembleLedger,diffLedgerRows}=await import('./ledgerRows');const {emptyLedger}=await import('./ledgerDomain');
 const date='2026-11-27T00:00:00Z',ledger=emptyLedger();
 ledger.expenses=Array.from({length:3000},(_,i)=>({...expense,id:'doc-'+i,amount:i+1,createdAt:date,approvedAt:date,lineItems:[{description:'item',quantity:1,unitPrice:i+1,totalPrice:i+1}]}));
 const state={ledger,draft:null,recoveries:[{id:'r1',createdAt:date,ledger:structuredClone(ledger),draft:null},{id:'r2',createdAt:date,ledger:structuredClone(ledger),draft:null}]};
 const rows=partitionLedger(state),activeRows=rows.filter(x=>!['recoveries','approval'].includes(x.table));
 const active=assembleLedger(activeRows,'active');assert.equal(active.ledger.expenses.length,3000);assert.deepEqual(active.ledger.expenses.map(x=>x.id),ledger.expenses.map(x=>x.id));assert.equal(active.ledger.expenses.reduce((n,x)=>n+x.amount,0),4501500);
 assert.ok(JSON.stringify(activeRows).length<JSON.stringify(rows).length);assert.throws(()=>assembleLedger(activeRows),/نامعتبر/);assert.throws(()=>assembleLedger(rows,'active'),/نامعتبر/);
 const changed=structuredClone(state);changed.ledger.expenses[1500].title='Changed';const patch=diffLedgerRows(rows,partitionLedger(changed));assert.deepEqual(patch.upserts.map(x=>x.table),['expenses']);assert.equal(patch.deletes.length,0);
});


test('attachment viewer verifies original bytes and never treats text as HTML',async()=>{
 const {readAttachmentPreview,identifyPreview,boundedPdfScale,TEXT_PREVIEW_BYTES}=await import('../utils/attachmentPreview');
 const {digestBytes,encodeBytes}=await import('./attachments');
 const text=new TextEncoder().encode('<script>alert(1)</script>');
 const id=await digestBytes(text),data=encodeBytes(text);
 const preview=await readAttachmentPreview({async get(){return data;}},id,'text/plain');
 assert.deepEqual(preview,{kind:'text',text:'<script>alert(1)</script>',truncated:false});
 await assert.rejects(()=>readAttachmentPreview({async get(){return data;}},id,'image/jpeg'));
 await assert.rejects(()=>readAttachmentPreview({async get(){return data;}},'0'.repeat(64),'text/plain'));
 const pdf=new TextEncoder().encode('%PDF-1.7');
 assert.equal(identifyPreview(pdf,'application/pdf').kind,'pdf');
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);assert.equal(identifyPreview(png,'image/png').kind,'image');
 const truncated=identifyPreview(new Uint8Array(TEXT_PREVIEW_BYTES+1),'text/csv');assert.ok(truncated.kind==='text'&&truncated.truncated);
 const scale=boundedPdfScale(50000,50000);assert.ok(scale*50000<=2400&&scale*scale*50000*50000<=4_000_001);
 assert.throws(()=>boundedPdfScale(0,100));
});


test('approval replay returns current values and rejects deleted records without recreating them',async()=>{
 const db=new DatabaseSync(':memory:');try{
 const store=new SqliteSnapshotStore(driver(db)),repo=new LocalLedgerRepository(store);await repo.initialize();
 const draft={id:'retry-draft',drafts:[{...expense,tempId:'a',selected:true},{...expense,tempId:'b',selected:true}],previewPages:[]};
 await repo.saveDraft(draft);
 const [first,second]=await repo.add([expense,expense],draft.id);
 await repo.update(first.id,{amount:54321});
 assert.equal((await repo.add([expense,expense],draft.id))[0].amount,54321);
 assert.equal((await repo.load()).expenses.length,2);
 await assert.rejects(()=>repo.add([expense],draft.id),/تعداد/);
 await assert.rejects(()=>repo.saveDraft(draft),/قبلاً/);
 await repo.remove(second.id);
 await assert.rejects(()=>repo.add([expense,expense],draft.id),/حذف/);
 assert.equal((await repo.load()).expenses.length,1);assert.equal(await repo.loadDraft(),null);
 }finally{db.close();}
});
test('simultaneous repeated approval and simulated lost acknowledgement do not duplicate expenses',async()=>{
 const db=new DatabaseSync(':memory:');try{
 const store=new SqliteSnapshotStore(driver(db));let loseReply=false;
 const original=store.compareAndSwap.bind(store);
 store.compareAndSwap=async(revision,state)=>{const ok=await original(revision,state);if(ok&&loseReply){loseReply=false;throw new Error('simulated lost acknowledgement');}return ok;};
 const repo=new LocalLedgerRepository(store);await repo.initialize();
 const draft={id:'lost-reply',drafts:[{...expense,tempId:'a',selected:true}],previewPages:[]};await repo.saveDraft(draft);
 loseReply=true;await assert.rejects(()=>repo.add([expense],draft.id),/lost acknowledgement/);
 const [a,b]=await Promise.all([repo.add([expense],draft.id),repo.add([expense],draft.id)]);
 assert.equal(a[0].id,b[0].id);assert.equal((await repo.load()).expenses.length,1);assert.equal(await repo.loadDraft(),null);
 }finally{db.close();}
});

test('stored records require stable identity and drafts reject unsafe preview URLs while allowing incomplete manual entry',async()=>{
 const {decodeStoredState}=await import('./sqliteStore');const {emptyLedger}=await import('./ledgerDomain');
 const ledger=emptyLedger(),draft={id:'manual',drafts:[{...expense,title:'',vendor:'',amount:0,tempId:'tmp',selected:true}],previewPages:[]};
 assert.equal(decodeStoredState(JSON.stringify({ledger,draft})).draft?.drafts[0].amount,0);
 assert.throws(()=>decodeStoredState(JSON.stringify({ledger,draft:{...draft,previewPages:['https://example.invalid/private']}})),/پیش‌نویس/);
 assert.throws(()=>decodeStoredState(JSON.stringify({ledger,draft:{...draft,drafts:[draft.drafts[0],draft.drafts[0]]}})),/پیش‌نویس/);
 assert.throws(()=>decodeStoredState(JSON.stringify({ledger:{...ledger,expenses:[expense]},draft:null})),/شناسه/);
});
test('disposing local repository rejects queued and in-flight writes before commit',async()=>{
 const db=new DatabaseSync(':memory:');try{
 const store=new SqliteSnapshotStore(driver(db)),repo=new LocalLedgerRepository(store);await repo.initialize();
 let release!:()=>void,entered!:()=>void;
 const enteredPromise=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 const original=store.read.bind(store);store.read=async()=>{const result=await original();entered();await barrier;return result;};
 const first=repo.add([expense]),second=repo.add([expense]);const results=Promise.allSettled([first,second]);
 await enteredPromise;repo.dispose();release();assert.deepEqual((await results).map(x=>x.status),['rejected','rejected']);
 assert.equal((await original()).state.ledger.expenses.length,0);
 await assert.rejects(()=>repo.load(),/نشست/);
 }finally{db.close();}
});

test('PDF report uses shared historical FX and payment totals in the selected unit',async()=>{
 const {buildPdfReport}=await import('../utils/pdfReport');const {emptyLedger}=await import('./ledgerDomain');const base=emptyLedger();const d='2026-11-27T00:00:00Z';const records=[{...expense,id:'r',createdAt:d,approvedAt:d,amount:12345,currency:'IRT' as const,paymentStatus:'paid' as const}];const report=buildPdfReport(records,base.rates,'IRR',base.categories??[],'گزارش','فیلتر');assert.equal(report.rows.length,1);assert.equal(report.total,report.paid);assert.equal(report.rows[0][3],report.total);assert.match(report.total,/۱۲۳,۴۵۰/);assert.match(report.remaining,/۰ ریال/);
});

test('multi-ledger migration keeps the original ledger, draft and recovery identities',async()=>{
 const {migrateSingleLedger,DEFAULT_LEDGER_ID,validateMultiLedger}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');
 const d='2026-11-27T00:00:00Z',record={...expense,id:'old-doc',createdAt:d,approvedAt:d};
 const ledger={...emptyLedger(),expenses:[record]};
 const draft={id:'old-draft',drafts:[{...expense,tempId:'old-temp',selected:true}],previewPages:[]};
 const original={ledger,draft,recoveries:[{id:'old-recovery',createdAt:d,ledger,draft}],lastApproval:{id:'old-approval',records:[record]}};
 const moved=migrateSingleLedger(original,d);
 assert.equal(moved.workspaces[0].profile.id,DEFAULT_LEDGER_ID);
 assert.equal(moved.workspaces[0].state.ledger.expenses[0].id,'old-doc');
 assert.deepEqual(moved.workspaces[0].state.draft,draft);
 assert.equal(moved.workspaces[0].state.recoveries?.[0].id,'old-recovery');
 assert.equal(moved.workspaces[0].state.lastApproval?.id,'old-approval');
 assert.deepEqual(validateMultiLedger(moved),moved);
});
test('multi-ledger catalog scopes real repository writes, drafts, budgets, recoveries and clears',async()=>{
 const {migrateSingleLedger,createLedger,ScopedLedgerStore,changeCatalog,editLedgerProfile,DEFAULT_LEDGER_ID,validateMultiLedger}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');
 const d='2026-11-27T00:00:00Z';
 let state=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'دفتر جم','#123456',d,'jam'),revision=0;
 const store={initialize:async()=>{},read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(expected:number,next:typeof state)=>{if(expected!==revision)return false;state=validateMultiLedger(next);revision++;return true;}};
 await changeCatalog(store,s=>editLedgerProfile(s,DEFAULT_LEDGER_ID,{name:'دفتر کرج'}));
 const karaj=new LocalLedgerRepository(new ScopedLedgerStore(store,DEFAULT_LEDGER_ID)),jam=new LocalLedgerRepository(new ScopedLedgerStore(store,'jam'));
 const [k]=await karaj.add([{...expense,title:'Karaj'}]);
 const [j]=await jam.add([{...expense,title:'Jam'}]);
 assert.equal((await karaj.load()).expenses[0].id,k.id);
 assert.equal((await jam.load()).expenses[0].id,j.id);
 await assert.rejects(()=>jam.update(k.id,{amount:99}),/یافت نشد/);
 await assert.rejects(()=>jam.remove(k.id),/یافت نشد/);
 const draft={id:'jam-draft',drafts:[{...expense,tempId:'x',selected:true}],previewPages:[]};
 await jam.saveDraft(draft);assert.equal(await karaj.loadDraft(),null);assert.deepEqual(await jam.loadDraft(),draft);
 await jam.settings([{category:'operations',monthlyLimitIRT:123}],{USD:80000,EUR:90000},{provider:'openai',model:'test'});
 assert.equal((await jam.load()).budgets[0].monthlyLimitIRT,123);assert.equal((await karaj.load()).budgets.length,0);
 await jam.createRecovery();await jam.clear('all');
 assert.equal((await jam.load()).expenses.length,0);assert.equal((await karaj.load()).expenses[0].id,k.id);
 await jam.restoreRecovery();assert.equal((await jam.load()).expenses[0].id,j.id);
 assert.equal((await karaj.recoveryList()).length,0);
 await assert.rejects(()=>changeCatalog(store,s=>editLedgerProfile(s,'jam',{archived:true})),/پیش‌نویس/);
 await jam.saveDraft(null);
 await changeCatalog(store,s=>editLedgerProfile(s,'jam',{archived:true}));
 await assert.rejects(()=>jam.add([expense]),/بایگانی/);
 await assert.rejects(()=>changeCatalog(store,s=>editLedgerProfile(s,DEFAULT_LEDGER_ID,{archived:true})),/نامعتبر/);
 assert.throws(()=>createLedger(state,'دفتر كرج','#123456',d,'duplicate'),/نامعتبر/);
});
test('multi-ledger CAS rejects stale writes without replacing another ledger',async()=>{
 const {migrateSingleLedger,createLedger,ScopedLedgerStore,DEFAULT_LEDGER_ID}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');const d='2026-11-27T00:00:00Z';
 let state=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'Jam','#123456',d,'jam'),revision=0;
 const store={initialize:async()=>{},read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(expected:number,next:typeof state)=>{if(expected!==revision)return false;state=structuredClone(next);revision++;return true;}};
 const first=new ScopedLedgerStore(store,DEFAULT_LEDGER_ID),second=new ScopedLedgerStore(store,'jam');
 const old=await first.read();const repo=new LocalLedgerRepository(second);await repo.add([expense]);
 assert.equal(await first.compareAndSwap(old.revision,old.state),false);
 assert.equal((await repo.load()).expenses.length,1);
});
test('consolidated reporting selects only requested ledgers and uses per-document FX',async()=>{
 const {migrateSingleLedger,createLedger,consolidateLedgers,DEFAULT_LEDGER_ID}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');const {DEFAULT_EXPENSE_FILTERS}=await import('../utils/finance');
 const d='2026-11-27T00:00:00Z';
 let root=createLedger(createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'Jam','#123456',d,'jam'),'Personal','#654321',d,'personal');
 const [k,j,p]=root.workspaces;
 k.state.ledger.expenses=[{...expense,id:'same',createdAt:d,approvedAt:d,currency:'USD',amount:10,exchangeRateToToman:70000}];
 j.state.ledger.expenses=[{...expense,id:'same',createdAt:d,approvedAt:d,currency:'IRT',amount:250000}];
 p.state.ledger.expenses=[{...expense,id:'personal',createdAt:d,approvedAt:d,currency:'IRT',amount:999}];
 const report=consolidateLedgers(root,[DEFAULT_LEDGER_ID,'jam'],{...DEFAULT_EXPENSE_FILTERS,sortBy:'amount_desc'});
 assert.equal(report.count,2);assert.equal(report.totalIRT,950000);assert.equal(report.paidIRT,950000);assert.equal(report.remainingIRT,0);
 assert.deepEqual(report.rows.map(x=>x.ledgerId),[DEFAULT_LEDGER_ID,'jam']);
 assert.deepEqual(report.byLedger.map(x=>x.totalIRT),[700000,250000]);
 assert.throws(()=>consolidateLedgers(root,['jam','jam']),/تکرار/);
 assert.throws(()=>consolidateLedgers(root,['missing']),/یافت نشد/);
 assert.throws(()=>consolidateLedgers(root,[DEFAULT_LEDGER_ID,'jam'],{...DEFAULT_EXPENSE_FILTERS,category:'operations'}),/تفکیک/);
});

test('workspace session refuses overlapping catalog operations and closes only persisted draft scope',async()=>{
 const {MultiLedgerSession}=await import('./multiLedgerSession');
 const {migrateSingleLedger,createLedger,DEFAULT_LEDGER_ID,validateMultiLedger}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');
 const d='2026-11-27T00:00:00Z';
 let state=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'Jam','#123456',d,'jam'),revision=0;
 const store={initialize:async()=>{},read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(expected:number,next:typeof state)=>{if(expected!==revision)return false;state=validateMultiLedger(next);revision++;return true;}};
 const session=new MultiLedgerSession(store);
 assert.equal((await session.catalog()).length,2);
 const karaj=await session.open(DEFAULT_LEDGER_ID);
 await assert.rejects(()=>session.open('jam'),/خارج شوید/);
 await assert.rejects(()=>session.edit('jam',{name:'New'}),/خارج شوید/);
 const draft={id:'karaj-draft',drafts:[{...expense,tempId:'x',selected:true}],previewPages:[]};
 const saving=karaj.repository.saveDraft(draft);
 await assert.rejects(()=>session.close(draft),/پایان ذخیره/);await saving;
 await assert.rejects(()=>session.close(null),/یکسان نیست/);
 await session.close(draft);
 await assert.rejects(()=>karaj.repository.add([expense]),/نشست/);
 const jam=await session.open('jam');assert.equal(await jam.repository.loadDraft(),null);
 await jam.repository.add([expense]);await session.close(null);
 const reopened=await session.open(DEFAULT_LEDGER_ID);assert.deepEqual(await reopened.repository.loadDraft(),draft);assert.equal((await reopened.repository.load()).expenses.length,0);
 session.dispose();await assert.rejects(()=>reopened.repository.add([expense]),/نشست/);
 await assert.rejects(()=>session.catalog(),/نشست/);
});
test('workspace catalog renders explicit ledger labels and scoped draft indicators',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{LedgerCatalog}=await import('../components/MultiLedgerWorkspace');
 const d='2026-11-27T00:00:00Z';
 const items=[{profile:{id:'karaj',name:'دفتر کرج',color:'#0f766e',archived:false,createdAt:d},count:2,hasDraft:true},{profile:{id:'jam',name:'دفتر جم',color:'#2563eb',archived:false,createdAt:d},count:1,hasDraft:false},{profile:{id:'personal',name:'شخصی',color:'#475569',archived:true,createdAt:d},count:4,hasDraft:false}];
 const html=renderToStaticMarkup(React.createElement(LedgerCatalog,{items,busy:false,error:'',onOpen:()=>{},onCreate:()=>{},onEdit:()=>{},onLock:()=>{},onRefresh:()=>{}}));
 assert.match(html,/دفتر کرج/);assert.match(html,/دفتر جم/);assert.match(html,/پیش‌نویس ذخیره‌شده/);assert.doesNotMatch(html,/شخصی/);assert.match(html,/ورود به دفتر/);
});

test('consolidated report snapshot, PDF rows and Excel numeric totals agree and exclude unselected ledgers',async()=>{
 const {migrateSingleLedger,createLedger,DEFAULT_LEDGER_ID}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');
 const {makeConsolidatedReport,buildConsolidatedPdf}=await import('../utils/consolidatedReport');
 const {buildConsolidatedWorkbook,consolidatedExcelBytes}=await import('../utils/consolidatedExcel');
 const d='2026-11-27T00:00:00Z';
 const root=createLedger(createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'Jam','#123456',d,'jam'),'Personal','#654321',d,'personal');
 root.workspaces[0].state.ledger.expenses=[{...expense,id:'same',createdAt:d,approvedAt:d,currency:'IRT',amount:25000}];
 root.workspaces[1].state.ledger.expenses=[{...expense,id:'same',createdAt:d,approvedAt:d,currency:'USD',amount:2,exchangeRateToToman:70000,paymentStatus:'pending'}];
 root.workspaces[2].state.ledger.expenses=[{...expense,id:'secret',title:'PersonalSecret',createdAt:d,approvedAt:d,currency:'IRT',amount:999}];
 const selection={ledgerIds:[DEFAULT_LEDGER_ID,'jam'],timeframe:'all' as const,query:'',paymentStatus:'all' as const,sortBy:'date_desc' as const};
 const report=makeConsolidatedReport(root,selection,new Date(d));
 assert.equal(report.totalIRT,165000);assert.equal(report.paidIRT,25000);assert.equal(report.remainingIRT,140000);
 const pdf=buildConsolidatedPdf(report,'IRR');assert.equal(pdf.rows.length,4);assert.equal(pdf.headers[2],'دفتر مالی');assert.match(pdf.total,/۱,۶۵۰,۰۰۰/);assert.doesNotMatch(JSON.stringify(pdf),/PersonalSecret/);
 const wb=buildConsolidatedWorkbook(report,'IRR');const summary=wb.Sheets['خلاصه دفاتر'],details=wb.Sheets['جزئیات اسناد'];
 assert.equal(summary.B8.v,1650000);assert.equal(summary.B9.v,250000);assert.equal(summary.B10.v,1400000);assert.equal(summary.B8.t,'n');
 assert.equal(Number(details.H2.v)+Number(details.H3.v),1650000);assert.doesNotMatch(JSON.stringify(wb),/PersonalSecret/);
 const bytes=consolidatedExcelBytes(report,'IRR');assert.equal(bytes[0],80);assert.equal(bytes[1],75);
 const pending=makeConsolidatedReport(root,{...selection,paymentStatus:'pending'},new Date(d));assert.equal(pending.count,1);assert.equal(pending.byLedger.length,2);assert.equal(pending.byLedger[0].count,0);
 assert.throws(()=>makeConsolidatedReport(root,{...selection,dateFrom:'2026-11-28',dateTo:'2026-11-27'}),/بازه/);
 const filtered=makeConsolidatedReport(root,{...selection,dateFrom:'2026-11-28'},new Date(d));assert.equal(filtered.count,0);
});


test('v3 multi-ledger backup preserves archived identities, recovery attachments, and excludes AI config and replay tokens',async()=>{
 const {migrateSingleLedger,createLedger,editLedgerProfile,DEFAULT_LEDGER_ID}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');const {digestBytes,encodeBytes}=await import('./attachments');
 const {writeMultiLedgerBackup,readMultiLedgerBackup,previewMultiLedgerBackup,isMultiLedgerBackup}=await import('./multiLedgerBackup');
 const {isStreamBackup,readStreamBackup}=await import('./streamBackup');
 const d='2026-11-27T00:00:00Z',pass='synthetic password 123';
 let root=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},d),'Jam','#123456',d,'jam');
 const raw=new Uint8Array([37,80,68,70,45,1,2]),id=await digestBytes(raw),data=encodeBytes(raw);
 const doc={...expense,id:'same',createdAt:d,approvedAt:d,attachmentId:id,attachmentMime:'application/pdf' as const};
 root.workspaces[0].state.ledger.expenses=[doc];
 root.workspaces[1].state.ledger.expenses=[{...doc,title:'Jam expense'}];
 root.workspaces[0].state.recoveries=[{id:'checkpoint',createdAt:d,ledger:structuredClone(root.workspaces[0].state.ledger),draft:null}];
 root.workspaces[0].state.lastApproval={id:'replay',records:[doc]};
 root=editLedgerProfile(root,'jam',{archived:true});
 const chunks:Uint8Array<ArrayBuffer>[]=[];let reads=0;
 await writeMultiLedgerBackup(root,pass,{async get(key){assert.equal(key,id);reads++;return data;}},async b=>{chunks.push(b);});
 const file=new Blob(chunks);assert.equal(reads,1);assert.equal(await isMultiLedgerBackup(file),true);assert.equal(await isStreamBackup(file),false);
 const preview=await previewMultiLedgerBackup(file,pass);assert.equal(preview.attachmentCount,1);
 assert.deepEqual(preview.manifest.workspaces.map(w=>w.profile.id),[DEFAULT_LEDGER_ID,'jam']);assert.equal(preview.manifest.workspaces[1].profile.archived,true);
 assert.equal(preview.manifest.workspaces[0].state.ledger.aiConfig,undefined);assert.equal(preview.manifest.workspaces[0].state.recoveries?.[0].ledger.aiConfig,undefined);assert.equal(preview.manifest.workspaces[0].state.lastApproval,undefined);
 let writes=0;const store={async put(key:string,value:string){assert.equal(key,id);assert.equal(value,data);writes++;}};
 const restored=await readMultiLedgerBackup(file,pass,store);assert.deepEqual(restored,preview.manifest);assert.equal(writes,1);
 await assert.rejects(()=>readMultiLedgerBackup(file,'wrong password',store));await assert.rejects(()=>readStreamBackup(file,pass,store));
 await assert.rejects(()=>readMultiLedgerBackup(file.slice(0,file.size-1),pass,store));
 await assert.rejects(()=>readMultiLedgerBackup(new Blob([...chunks,new Uint8Array([1])]),pass,store));
});


test('full restore session requires matching preview and successful safety backup, and rejects stale revisions',async()=>{
 const {MultiLedgerSession}=await import('./multiLedgerSession');const {migrateSingleLedger,createLedger,validateMultiLedger}=await import('./multiLedger');
 const {emptyLedger}=await import('./ledgerDomain');const {writeMultiLedgerBackup}=await import('./multiLedgerBackup');
 const date='2026-11-27T00:00:00Z',pass='synthetic password 123';
 let state=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},date),'Existing','#123456',date,'existing'),revision=7,restores=0;
 const replacement=createLedger(migrateSingleLedger({ledger:emptyLedger(),draft:null},date),'Restored','#654321',date,'restored');
 const chunks:Uint8Array<ArrayBuffer>[]=[];await writeMultiLedgerBackup(replacement,pass,undefined,async b=>{chunks.push(b);});const file=new Blob(chunks);
 const store={initialize:async()=>{},read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async()=>false,restoreAll:async(expected:number,next:typeof state)=>{if(expected!==revision)return false;state=validateMultiLedger(next);revision++;restores++;return true;}};
 const s=new MultiLedgerSession(store),preview=await s.previewBackup(file,pass);
 await assert.rejects(()=>s.restoreBackup(file,pass,preview,async()=>{throw Error('safety export failed');},pass),/safety export failed/);
 assert.equal(restores,0);assert.equal(state.workspaces[1].profile.id,'existing');
 revision++;await assert.rejects(()=>s.restoreBackup(file,pass,preview,async()=>{},pass),/پیش‌نمایش/);assert.equal(restores,0);
 const nextPreview=await s.previewBackup(file,pass);let safetyBytes=0;
 await s.restoreBackup(file,pass,nextPreview,async write=>{await write(async b=>{safetyBytes+=b.length;});},pass);
 assert.ok(safetyBytes>52);assert.equal(restores,1);assert.equal(state.workspaces[1].profile.id,'restored');
});
