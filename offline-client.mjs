import { initialState, reduceAction } from './domain.mjs';
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
export function createOfflineApi(native){
 function load(){const current=JSON.parse(native.load());if(current.ok===false||current.version<0)throw Error(current.error||'Your local records could not be opened.');return {state:current.state||initialState(),version:current.version};}
 return async function request(path,options={}){
  try{
   if(path==='/api/state')return reply(load());
   if(path!=='/api/action')return reply({error:'Unknown action.'},404);
   const body=JSON.parse(options.body);
   if(typeof body.type!=='string'||typeof body.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(body.requestId))return reply({error:'A valid action and unique request ID are required.'},400);
   const fingerprint=JSON.stringify({type:body.type,payload:body.payload});
   const id=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
   for(let attempt=0;attempt<3;attempt++){
    const current=load();const cached=(current.state._requests||[]).find(r=>r.id===body.requestId);
    if(cached){if(cached.fingerprint&&cached.fingerprint!==fingerprint)return reply({error:'This request ID has already been used for another action.'},409);return reply({...current,result:cached.result});}
    let next;try{next=reduceAction(current.state,body.type,body.payload,{id});}catch(e){return reply({error:e.message},400)}
    next.state._requests=[...(next.state._requests||[]).slice(-99),{id:body.requestId,fingerprint,result:next.result}];
    const saved=JSON.parse(native.save(current.version,JSON.stringify(next.state)));
    if(saved.ok)return reply({state:next.state,version:saved.version,result:next.result});
    if(saved.version!==current.version&&saved.version>=0)continue;
    return reply({error:saved.error||'Your change was not saved.'},400);
   }
   return reply({error:'The store changed. Please retry.'},409);
  }catch(e){return reply({error:e.message||'Local storage could not be reached.'},503)}
 }
}
