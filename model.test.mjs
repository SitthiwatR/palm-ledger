import test from 'node:test';
import assert from 'node:assert/strict';
import {minor,quantityTotal,summarize,addPayment,allocateRecord,demoState,validateState,recordCheck} from './model.mjs';

test('garden totals add up, pending expenses count once, and fertilizer is only applied bags',()=>{
 const s=demoState();assert.equal(summarize(s,'home').net,2800000);assert.equal(summarize(s,'canal').net,1480000);assert.equal(summarize(s).net,4280000);assert.equal(summarize(s).pending,620000);
 assert.equal(quantityTotal('4','800'),320000);assert.equal(quantityTotal('3500','1000',1000),350000);assert.equal(quantityTotal('0.5','500'),25000);
 const before=summarize(s),r=s.records.find(r=>r.id==='wage1');
 const updated=addPayment(r,100000,'2026-10-19');const next={...s,records:s.records.map(x=>x.id===r.id?updated:x)};
 assert.equal(summarize(next).net,before.net);assert.equal(summarize(next).pending,before.pending-100000);
 assert.throws(()=>addPayment(updated,99999999,'2026-10-19'));assert.throws(()=>addPayment(updated,-1,'2026-10-19'));
});
test('shared allocation preserves total expense and debt even for tiny rounded shares',()=>{
 const s={version:1,demo:false,gardens:['a','b','c','d'].map(id=>({id,name:id,opening:0})),records:[{id:'shared1',kind:'expense',garden:'shared',date:'2026-10-19',category:'maintenance',title:'ซ่อมรถ',amount:4,paid:2}]};
 const next=allocateRecord(s,'shared1',s.gardens.map(g=>({garden:g.id,amount:1})));
 assert.equal(summarize(s).net,summarize(next).net);assert.equal(summarize(s).pending,summarize(next).pending);next.records.forEach(r=>assert.ok(r.paid>=0&&r.paid<=r.amount));
 assert.throws(()=>allocateRecord(s,'shared1',[{garden:'a',amount:3}]));validateState(next);
});
test('opening balances and legacy debt do not double-count historical expenses',()=>{
 const s={version:1,demo:false,gardens:[{id:'a',name:'สวน A',opening:500000}],records:[{id:'debt',kind:'expense',garden:'a',date:'2026-10-19',category:'other',title:'หนี้เดิม',amount:100000,paid:0,opening:true}]};
 assert.equal(summarize(s).net,500000);assert.equal(summarize(s).pending,100000);assert.equal(summarize(s,null,'2026-10-19','2026-10-19').net,0);
});
test('invalid imports, negative values, unpaid income and duplicate IDs are rejected',()=>{
 assert.equal(minor('10.05'),1005);assert.throws(()=>minor('-1'));assert.throws(()=>minor('1.001'));assert.throws(()=>minor('Infinity'));
 const s=demoState();assert.throws(()=>recordCheck({...s.records[0],paid:0},s.gardens));assert.throws(()=>validateState({...s,records:[s.records[0],s.records[0]]}));assert.throws(()=>validateState({...s,records:[{...s.records[0],garden:'missing'}]}));assert.throws(()=>validateState({...s,records:[{...s.records[0],photo:'javascript:alert(1)'}]}));
});
