const fs=require('node:fs')
;(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(tabs.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 let prior,evaluate,changed=false
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
  const delay=ms=>new Promise(r=>setTimeout(r,ms))
  prior=await evaluate(`(async()=>({agent:await window.threadlight.getAgent(),motion:await window.threadlight.getMotion(),view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label^="Pinned open"]'),settings:await window.threadlight.getSettings()}))()`)
  if(prior.agent.status!=='idle'||prior.agent.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01||!prior.view)throw Error('Agent, voice or subpage active; defer refresh')
  const before=await evaluate(`(()=>{const row=document.querySelector('[data-session-id] button');const bottom=document.querySelector('[class*="_rowBottom_"]');return {padding:row&&getComputedStyle(row).paddingTop,gap:bottom&&getComputedStyle(bottom).marginTop}})()`)
  await call('Page.reload',{ignoreCache:true});changed=true;await delay(850)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly();window.threadlight.updateSettings({hoverHelp:'off'})`)
  const choose=async view=>{
   if(await evaluate(`document.querySelector('[data-thread-view]')?.dataset.threadView`)===view.toLowerCase())return
   await evaluate(`document.querySelector('[data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()===${JSON.stringify(view)})?.click()`);await delay(250)
  }
  const read=()=>evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-workspace-thread-list] [data-session-id]')];return rows.map((row,index)=>{const button=row.querySelector('button'),bottom=row.querySelector('[class*="_rowBottom_"]');return {index,id:row.dataset.sessionId,striped:row.hasAttribute('data-striped'),padding:getComputedStyle(button).paddingTop,gap:getComputedStyle(bottom).marginTop,bg:getComputedStyle(row).backgroundColor,inset:getComputedStyle(row).getPropertyValue('--thread-inset').trim()}})})()`)
  const result={before}
  for(const view of ['Active','Recent','Workspace']){
   await choose(view)
   for(let n=0;n<50;n++){if((await read()).length>0)break;await delay(100)}
   const rows=await read()
   if(rows.some((row,index)=>row.striped!==(index%2===1)||row.padding!=='1.5px'||row.gap!=='1px'))throw Error('Row spacing or stripe sequence mismatch '+JSON.stringify(rows.slice(0,15)))
   result[view]={count:rows.length,nested:rows.filter(r=>parseInt(r.inset)>0).length,examples:rows.slice(0,4)}
   const shot=await call('Page.captureScreenshot',{format:'png'})
   fs.writeFileSync(`screenshots-local/compact-rows-${view.toLowerCase()}-native.local.png`,Buffer.from(shot.result.data,'base64'))
  }
  await choose(prior.view[0].toUpperCase()+prior.view.slice(1))
  console.log(JSON.stringify(result))
 }finally{
  if(changed&&prior&&evaluate)await evaluate(`window.threadlight.updateSettings({listMode:${JSON.stringify(prior.settings.listMode)},hoverHelp:${JSON.stringify(prior.settings.hoverHelp)}});if(${prior.pinned}&&!document.querySelector('header button[aria-label^="Pinned open"]'))document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));window.threadlight.setStayOpen(${prior.pinned})`)
  ws.close()
 }
})().catch(e=>{console.error(e);process.exitCode=1})
