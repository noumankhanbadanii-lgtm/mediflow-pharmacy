import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineApi} from '../offline-client.mjs';
test('offline Android bridge persists validated actions, survives restart and deduplicates retries',async()=>{
 let saved={state:null,version:0};const native={load:()=>JSON.stringify(saved),save:(version,data)=>{assert.equal(version,saved.version);saved={state:JSON.parse(data),version:version+1};return JSON.stringify({ok:true,version:saved.version})}};
 const api=createOfflineApi(native),request={type:'saveMedicine',payload:{name:'Test tablet',unit:'Tablet'},requestId:'offline-test-request'};
 let result=await api('/api/action',{body:JSON.stringify(request)});assert.equal(result.ok,true);assert.equal(saved.state.medicines.length,1);
 result=await api('/api/action',{body:JSON.stringify(request)});assert.equal(result.ok,true);assert.equal(saved.version,1);
 const restarted=createOfflineApi(native);assert.equal((await (await restarted('/api/state')).json()).state.medicines[0].name,'Test tablet');
 const invalid=await api('/api/action',{body:JSON.stringify({type:'addBatch',payload:{medicineId:'missing'},requestId:'another-request'})});assert.equal(invalid.status,400);assert.equal(saved.version,1);
});
