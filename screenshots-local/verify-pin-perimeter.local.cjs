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
  prior=await evaluate(`(async()=>({agent:await window.threadlight.getAgent(),motion:await window.threadlight.getMotion(),view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:document.querySelector('[data-card]').hasAttribute('data-pinned')||!!document.querySelector('header button[aria-label^="Pinned open"]'),settings:await window.threadlight.getSettings()}))()`)
  if(prior.agent.status!=='idle'||prior.agent.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01||!prior.view)throw Error('Agent, voice or subpage active; defer refresh')
  const read=()=>evaluate(`(()=>{const card=document.querySelector('[data-card]'),source=document.querySelector('header button[aria-label^="Filter applications:"]'),group=source.parentElement,previous=group.previousElementSibling;return {pinned:card.hasAttribute('data-pinned'),border:getComputedStyle(card).borderTopColor,wire:getComputedStyle(document.querySelector('[data-header-wire] .conductor')).stroke,glow:getComputedStyle(card).boxShadow,headerGlow:getComputedStyle(document.querySelector('header'),'::after').boxShadow,glowBottom:getComputedStyle(document.querySelector('header'),'::after').bottom,background:getComputedStyle(card).backgroundImage,gap:group.getBoundingClientRect().x-previous.getBoundingClientRect().right,providerInset:source.getBoundingClientRect().x-group.getBoundingClientRect().x,icons:document.querySelectorAll('header button[aria-label^="Pinned open"]').length,view:document.querySelector('[data-thread-view]').dataset.threadView}})()`)
  const before=await read()
  await call('Page.reload',{ignoreCache:true});changed=true;await delay(800)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly();window.threadlight.updateSettings({hoverHelp:'off'})`)
  if(prior.view!=='active'){
   await evaluate(`document.querySelector('[data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().toLowerCase()===${JSON.stringify(prior.view)})?.click()`)
  }
  await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`)
  await delay(250)
  const pinned=await read()
  if(!pinned.pinned||pinned.glow!=='none'||pinned.headerGlow==='none'||pinned.glowBottom!=='6px'||pinned.background==='none'||pinned.icons!==0||pinned.gap!==2||pinned.providerInset!==4)throw Error('Pin presentation mismatch '+JSON.stringify(pinned))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/muted-header-pin-native.local.png',Buffer.from(shot.result.data,'base64'))
  await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));window.threadlight.setStayOpen(true)`)
  await delay(160)
  const unpinned=await read()
  if(unpinned.pinned||unpinned.glow!=='none'||unpinned.view!==pinned.view)throw Error('Unpin did not preserve view')
  console.log(JSON.stringify({before,pinned,unpinned}))
 }finally{
  if(changed&&prior&&evaluate)await evaluate(`window.threadlight.updateSettings({hoverHelp:${JSON.stringify(prior.settings.hoverHelp)},listMode:${JSON.stringify(prior.settings.listMode)}});if(document.querySelector('[data-card]').hasAttribute('data-pinned')!==${prior.pinned})document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));window.threadlight.setStayOpen(${prior.pinned})`)
  ws.close()
 }
})().catch(e=>{console.error(e);process.exitCode=1})
