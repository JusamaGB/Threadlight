const fs=require('node:fs')
;(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(tabs.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 let evaluate,prior,changed=false
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
  const delay=ms=>new Promise(r=>setTimeout(r,ms))
  prior=await evaluate(`(async()=>({agent:await window.threadlight.getAgent(),motion:await window.threadlight.getMotion(),view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:document.querySelector('[data-card]').hasAttribute('data-pinned'),settings:await window.threadlight.getSettings()}))()`)
  if(prior.agent.status!=='idle'||prior.agent.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01||!prior.view)throw Error('Agent, voice or subpage active; defer refresh')
  await call('Page.reload',{ignoreCache:true});changed=true;await delay(800)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly();window.threadlight.updateSettings({hoverHelp:'tour'})`)
  if(prior.view!=='active'){
   await evaluate(`document.querySelector('[data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().toLowerCase()===${JSON.stringify(prior.view)})?.click()`)
  }
  if(prior.pinned)await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`)
  for(let n=0;n<40;n++){if(await evaluate(`!!document.querySelector('[data-session-id] [aria-label^="Thread diff"]')`))break;await delay(100)}
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:100})
  const point=await evaluate(`(()=>{const r=document.querySelector('[data-session-id] [aria-label^="Thread diff"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await delay(350)
  const result=await evaluate(`(()=>{const tip=document.querySelector('[data-hover-message] [role="tooltip"]'),info=tip?.querySelector('[class*="_tipInfo_"]'),help=tip?.querySelector('[class*="_tipHelp_"]');return {info:info?.innerText,help:help?.innerText,infoColour:info&&getComputedStyle(info).color,helpColour:help&&getComputedStyle(help).color,separate:info&&help&&help.getBoundingClientRect().top>info.getBoundingClientRect().bottom,divider:tip?.querySelectorAll('[role="separator"]').length}})()`)
  if(!result.separate||result.helpColour!=='rgb(161, 161, 161)'||result.infoColour===result.helpColour||result.divider!==1)throw Error('Hint separation mismatch '+JSON.stringify(result))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/formatted-thread-hint-native.local.png',Buffer.from(shot.result.data,'base64'))
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:100})
  console.log(JSON.stringify(result))
 }finally{
  if(changed&&prior&&evaluate)await evaluate(`window.threadlight.updateSettings({hoverHelp:${JSON.stringify(prior.settings.hoverHelp)},listMode:${JSON.stringify(prior.settings.listMode)}});if(document.querySelector('[data-card]').hasAttribute('data-pinned')!==${prior.pinned})document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));window.threadlight.setStayOpen(${prior.pinned})`)
  ws.close()
 }
})().catch(e=>{console.error(e);process.exitCode=1})
