const fs=require('node:fs')
;(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(tabs.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
  const delay=ms=>new Promise(r=>setTimeout(r,ms))
  const prior=await evaluate(`(async()=>{const a=await window.threadlight.getAgent();const m=await window.threadlight.getMotion();const nav=document.querySelector('[aria-label="Workspace folder navigation"]');return {live:!!a.live,motion:m,pinned:!!document.querySelector('header button[aria-label^="Pinned open"]'),folder:nav?.querySelector('span[title]')?.title??nav?.querySelector('[aria-label^="Use "]')?.title,settings:await window.threadlight.getSettings()}})()`)
  if(prior.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01)throw Error('Voice is active; defer UI refresh')
  await evaluate(`document.querySelector('header button[aria-label="Back to sessions"]')?.click()`)
  const view=await evaluate(`document.querySelector('header [data-thread-view]')?.dataset.threadView`)
  await call('Page.reload',{ignoreCache:true});await delay(700)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
  if(view&&view!=='active'){
   await evaluate(`document.querySelector('header [data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().toLowerCase()===${JSON.stringify(view)})?.click()`)
  }
  await evaluate(`document.querySelector('header button[aria-label^="Choose workspace:"]')?.click()`);await delay(150)
  await evaluate(`(()=>{const rows=document.querySelector('#workspace-folders');[...rows.querySelectorAll('button')].find(b=>b.textContent.startsWith('Z:'))?.click()})()`);await delay(100)
  await evaluate(`document.querySelector('[aria-label="Browse General"]')?.click()`);await delay(100)
  if(prior.pinned){await evaluate(`document.querySelector('header [class*="_pageHeading_"]').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`);await delay(80)}
  const result=await evaluate(`(async()=>{const nav=document.querySelector('[aria-label="Workspace folder navigation"]');const back=nav.querySelector('[aria-label="Parent folder"]');const use=nav.querySelector('[aria-label^="Use "]');const s=await window.threadlight.getSettings();return {label:use.getAttribute('aria-label'),sameRow:back.getBoundingClientRect().top===use.getBoundingClientRect().top,colours:[...use.querySelectorAll('span')].map(span=>getComputedStyle(span).color),buttons:nav.querySelectorAll('button').length,chosen:s.combinedFocusWorkspace,provider:s.enabledProviders}})()`)
  if(result.label!=='Use Z:/General'||!result.sameRow||result.buttons!==2)throw Error(JSON.stringify(result))
  if(result.chosen!==prior.settings.combinedFocusWorkspace||JSON.stringify(result.provider)!==JSON.stringify(prior.settings.enabledProviders))throw Error('Workspace selection changed')
  console.log(JSON.stringify(result))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/workspace-use-path-native.local.png',Buffer.from(shot.result.data,'base64'))
  await evaluate(`window.threadlight.setStayOpen(${Boolean(prior.pinned)})`)
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
