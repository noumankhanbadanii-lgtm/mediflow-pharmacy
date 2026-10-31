import { initialState, reduceAction } from './domain.mjs';
const STORE_ID='main';const MAX_BODY=2000000;const MAX_STATE=1500000;
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function readState(env){
 if(!env.DB)throw new Error('Database is not connected. Please contact the app administrator.');
 let row=await env.DB.prepare('SELECT version, data FROM pharmacy_state WHERE store_id = ?').bind(STORE_ID).first();
 if(!row){await env.DB.prepare('INSERT OR IGNORE INTO pharmacy_state (store_id, version, data) VALUES (?, 0, ?)').bind(STORE_ID,JSON.stringify(initialState())).run();row=await env.DB.prepare('SELECT version, data FROM pharmacy_state WHERE store_id = ?').bind(STORE_ID).first();}
 return {state:JSON.parse(row.data),version:row.version};
}
export async function handleApi(request,env){
 const url=new URL(request.url);
 try{
   if(request.method==='GET'&&url.pathname==='/api/state')return response(await readState(env));
   if(request.method!=='POST'||url.pathname!=='/api/action')return response({error:'Endpoint not found.'},404);
   const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return response({error:'Cross-origin writes are not allowed.'},403);
   if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))return response({error:'Send application/json.'},415);
   if(Number(request.headers.get('content-length')||0)>MAX_BODY)return response({error:'Backup or request is too large (2 MB maximum).'},413);
   const reader=request.body?.getReader();if(!reader)return response({error:'Request body is required.'},400);let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return response({error:'Backup or request is too large (2 MB maximum).'},413);}chunks.push(value);}
   const buffer=new Uint8Array(size);let pos=0;for(const chunk of chunks){buffer.set(chunk,pos);pos+=chunk.byteLength;}
   let body;try{body=JSON.parse(new TextDecoder().decode(buffer));}catch{return response({error:'Invalid JSON.'},400);}
   if(!body||typeof body.type!=='string'||typeof body.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(body.requestId))return response({error:'A valid action and unique request ID are required.'},400);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({type:body.type,payload:body.payload})));const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
   for(let attempt=0;attempt<8;attempt++){
     const current=await readState(env);const cached=(current.state._requests||[]).find(r=>r.id===body.requestId);
     if(cached){if(cached.hash!==hash)return response({error:'This request ID has already been used for another action.'},409);return response({...current,result:cached.result});}
     let next;try{next=reduceAction(current.state,body.type,body.payload);}catch(error){return response({error:error.message||'The action could not be completed.'},400);}
     next.state._requests=[...(next.state._requests||[]).slice(-499),{id:body.requestId,hash,result:next.result}];
     const data=JSON.stringify(next.state);if(new TextEncoder().encode(data).byteLength>MAX_STATE)return response({error:'Store storage is approaching its capacity. Export a backup and contact support to migrate to a larger database before adding more records.'},409);
     const result=await env.DB.prepare('UPDATE pharmacy_state SET version = ?, data = ? WHERE store_id = ? AND version = ?').bind(current.version+1,data,STORE_ID,current.version).run();
     if(result.meta?.changes===1)return response({state:next.state,version:current.version+1,result:next.result});
   }
   return response({error:'The store was updated by another session. Please retry.'},409);
 }catch(error){console.error('MediFlow API error:',error.message);return response({error:'The database could not be reached. Your changes were not saved. Please retry.'},503);}
}
