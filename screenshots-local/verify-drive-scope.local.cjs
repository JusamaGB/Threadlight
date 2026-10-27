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
  const prior=await evaluate(`(async()=>{const a=await window.threadlight.getAgent();return {settings:await window.threadlight.getSettings(),live:!!a.live,motion:await window.threadlight.getMotion(),pinned:!!document.querySelector('header button[aria-label^="Pinned open"]')}})()`)
  if(prior.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01)throw Error('Voice active; defer UI refresh')
  for(let i=0;i<4;i++){if(await evaluate(`!!document.querySelector('header [data-thread-view]')`))break;await evaluate(`(document.querySelector('header button[aria-label="Back to sessions"]')??document.querySelector('header button[aria-label="Back in Shared Spaces"]'))?.click()`);await delay(80)}
  const view=await evaluate(`document.querySelector('header [data-thread-view]')?.dataset.threadView`)
  await call('Page.reload',{ignoreCache:true});await delay(700)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
  if(view&&view!=='active'){
   await evaluate(`document.querySelector('header [data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().toLowerCase()===${JSON.stringify(view)})?.click()`)
  }
  await evaluate(`document.querySelector('header button[aria-label^="Choose workspace:"]').click()`);await delay(150)
  await evaluate(`document.querySelector('#workspace-folders button[title="Z:"]').click()`);await delay(100)
  await evaluate(`document.querySelector('[aria-label="Use Z:"]').click()`)
  await delay(350)
  let settled=0
  for(let i=0;i<80;i++){
    const ready=await evaluate(`(()=>{const count=Number(document.querySelector('[data-thread-view]')?.textContent.match(/\\d+$/)?.[0]??0);return count>0&&document.querySelectorAll('[data-session-id]').length===count})()`)
    settled=ready?settled+1:0
    if(settled>=3)break
    await delay(100)
  }
  if(prior.pinned){await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`);await delay(80)}
  const result=await evaluate(`(async()=>{const s=await window.threadlight.getSettings();return {view:document.querySelector('[data-thread-view]')?.textContent,workspace:document.querySelector('header button[aria-label^="Choose workspace:"]')?.textContent,rows:document.querySelectorAll('[data-session-id]').length,hours:s.listWindowHours,provider:s.enabledProviders,chosen:s.combinedFocusWorkspace,asset:document.querySelector('script[type="module"]').src}})()`)
  if(!result.rows||result.workspace!=='Z:'||result.hours!==prior.settings.listWindowHours)throw Error(JSON.stringify(result))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/drive-scope-native.local.png',Buffer.from(shot.result.data,'base64'))
  const selected=prior.settings.enabledProviders.length===2?'combinedFocusWorkspace':prior.settings.enabledProviders[0]==='codex'?'codexFocusWorkspace':'focusWorkspace'
  await evaluate(`window.threadlight.updateSettings(${JSON.stringify({[selected]:prior.settings[selected],workspaceAllDrives:prior.settings.workspaceAllDrives,listMode:prior.settings.listMode})})`)
  await evaluate(`window.threadlight.setStayOpen(${Boolean(prior.pinned)})`)
  console.log(JSON.stringify(result))
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
