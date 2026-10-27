const fs = require('node:fs');
(async()=>{
const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl);
try{
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value};
const prior=await evaluate(`(async()=>{const agent=await window.threadlight.getAgent();return {header:document.querySelector('header')?.textContent,view:document.querySelector('header [data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label="Unpin"]'),agent}})()`);
fs.writeFileSync('screenshots-local/narrow-prior.json',JSON.stringify(prior,null,2));console.log(JSON.stringify(prior));
}finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
