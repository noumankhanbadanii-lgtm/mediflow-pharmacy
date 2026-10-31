import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../backend.mjs';
import {initialState,reduceAction} from '../domain.mjs';
function memoryDatabase(state=initialState()){
 let row={version:0,data:JSON.stringify(state)};
 return {prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){await Promise.resolve();return row?structuredClone(row):null;},async run(){await Promise.resolve();if(sql.startsWith('INSERT')){if(!row)row={version:0,data:args[1]};return {meta:{changes:1}};}if(sql.startsWith('UPDATE')){if(row.version!==args[3])return {meta:{changes:0}};row={version:args[0],data:args[1]};return {meta:{changes:1}};}throw new Error('Unsupported fake SQL');}};}};
}
function action(type,payload,requestId='request-12345678',extraHeaders={}){
 return new Request('https://mediflow.test/api/action',{method:'POST',headers:{'content-type':'application/json',origin:'https://mediflow.test',...extraHeaders},body:JSON.stringify({type,payload,requestId})});
}
test('API persists mutations, deduplicates retry and rejects reused ID with another payload',async()=>{
 const env={DB:memoryDatabase()};const payload={name:'Test customer',openingBalance:100};
 const a=await handleApi(action('saveCustomer',payload),env);assert.equal(a.status,200);const first=await a.json();assert.equal(first.version,1);
 const again=await (await handleApi(action('saveCustomer',payload),env)).json();assert.equal(again.state.customers.length,1);assert.equal(again.version,1);assert.equal(again.result.id,first.result.id);
 const conflicting=await handleApi(action('saveCustomer',{...payload,name:'Other'}),env);assert.equal(conflicting.status,409);
 const state=await (await handleApi(new Request('https://mediflow.test/api/state'),env)).json();assert.equal(state.state.customers[0].name,'Test customer');assert.equal(state.version,1);
});
test('concurrent checkout updates cannot oversell the last unit',async()=>{
 let state=initialState();state=reduceAction(state,'saveMedicine',{name:'Test medicine'}).state;state=reduceAction(state,'addBatch',{medicineId:state.medicines[0].id,batchNo:'B1',expiry:'2099-01-01',qty:1,cost:5,price:10}).state;
 const env={DB:memoryDatabase(state)};const payload={items:[{batchId:state.batches[0].id,qty:1}],paid:10,method:'Cash'};
 const responses=await Promise.all([handleApi(action('checkout',payload,'checkout-11111111'),env),handleApi(action('checkout',payload,'checkout-22222222'),env)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);const final=await (await handleApi(new Request('https://mediflow.test/api/state'),env)).json();assert.equal(final.state.batches[0].qty,0);assert.equal(final.state.sales.length,1);
});
test('write API checks origin, content type and request IDs before applying changes',async()=>{
 const env={DB:memoryDatabase()};assert.equal((await handleApi(action('saveCustomer',{name:'X'},'request-33333333',{origin:'https://foreign.test'}),env)).status,403);
 assert.equal((await handleApi(new Request('https://mediflow.test/api/action',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'}),env)).status,415);
 assert.equal((await handleApi(action('saveCustomer',{name:'X'},'short'),env)).status,400);
 const final=await (await handleApi(new Request('https://mediflow.test/api/state'),env)).json();assert.equal(final.version,0);assert.equal(final.state.customers.length,0);
});
