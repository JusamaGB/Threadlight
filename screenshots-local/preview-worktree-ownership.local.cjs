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
  const prior=await evaluate(`(async()=>{const a=await window.threadlight.getAgent();const snapshot=await window.threadlight.getSnapshot();const rows=[];const walk=nodes=>{for(const n of nodes){rows.push(n.session);walk(n.children)}};for(const w of snapshot.workspaces)walk(w.threads);const candidates=[...new Map([...snapshot.sessions,...snapshot.lookupSessions??[],...rows].map(s=>[s.id,s])).values()].filter(s=>s.threadDiff?.files>0);let target;for(const session of candidates){const own=await window.threadlight.getChanges(session.id);if(own?.files.some(f=>f.path.replaceAll('\\\\','/').endsWith('src/main/tray.ts'))){target=session.id;break}}return {target,live:!!a.live,motion:await window.threadlight.getMotion(),pinned:!!document.querySelector('header button[aria-label^="Pinned open"]'),view:document.querySelector('[data-thread-view]')?.dataset.threadView}})()`)
  if(!prior.target)throw Error('No visible thread with recorded pending tray edits found')
  if(prior.live||prior.motion.mode==='listening'||prior.motion.input.level>0.01)throw Error('Voice is active; defer UI refresh')
  await call('Page.reload',{ignoreCache:true});await delay(800)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
  const mode=prior.view??'workspace'
  if(mode!=='active'){
   await evaluate(`document.querySelector('header [data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:12}))`);await delay(80)
   await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().toLowerCase()===${JSON.stringify(mode)})?.click()`)
  }
  for(let i=0;i<30;i++){if(await evaluate(`[...document.querySelectorAll('[data-session-id]')].some(el=>el.dataset.sessionId===${JSON.stringify(prior.target)})`))break;await delay(100)}
  const opened=await evaluate(`(()=>{const row=[...document.querySelectorAll('[data-session-id]')].find(el=>el.dataset.sessionId===${JSON.stringify(prior.target)});if(!row)return false;row.querySelector('button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:150,clientY:60}));return true})()`)
  if(!opened)throw Error('Selected thread is not visible after refresh')
  await delay(80)
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent==='Worktree diff')?.click()`)
  for(let i=0;i<30;i++){if(await evaluate(`!!document.querySelector('[class*="_fileRow_"][data-provider]')`))break;await delay(100)}
  if(prior.pinned){await evaluate(`document.querySelector('header [class*="_pageHeading_"]').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`);await delay(80)}
  const result=await evaluate(`(async()=>{const own=await window.threadlight.getChanges(${JSON.stringify(prior.target)});const files=await window.threadlight.getWorktreeChanges(${JSON.stringify(prior.target)});return {own:own?.files.map(f=>f.path),worktree:files.files.map(f=>f.path),rows:[...document.querySelectorAll('[class*="_fileRow_"]')].map(row=>({path:row.querySelector('button').title,provider:row.dataset.provider,gradient:getComputedStyle(row,'::before').backgroundImage})),asset:document.querySelector('script[type="module"]').src}})()`)
  const key=path=>path.replaceAll('\\','/').toLowerCase()
  const expected=result.worktree.filter(path=>result.own.some(own=>key(own)===key(path))).sort()
  const actual=result.rows.filter(row=>row.provider).map(row=>row.path).sort()
  if(JSON.stringify(expected)!==JSON.stringify(actual)||!actual.length)throw Error(JSON.stringify({expected,actual}))
  if(result.rows.some(row=>row.provider&&row.provider!==(prior.target.startsWith('codex:')?'codex':'claude')))throw Error('Wrong provider tint')
  console.log(JSON.stringify({files:result.rows.length,highlighted:actual,provider:result.rows.find(row=>row.provider)?.provider,asset:result.asset}))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/worktree-ownership-native.local.png',Buffer.from(shot.result.data,'base64'))
  await evaluate(`window.threadlight.setStayOpen(${Boolean(prior.pinned)})`)
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
