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
