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
      async read(){return schema===2?{revision:rev,schema,payload}:{revision:rev,schema,rows:JSON.stringify([...rows.values()])};},
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
