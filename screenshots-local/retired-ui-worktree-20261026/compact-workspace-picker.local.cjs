const fs=require('node:fs')
;(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(tabs.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
  const pinned=await evaluate(`!!document.querySelector('header button[aria-label="Unpin"]')`)
  await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
  await evaluate(`(()=>{if(!document.querySelector('header')?.textContent.includes('Choose workspace'))document.querySelector('header button[aria-label^="Choose workspace:"]')?.click()})()`)
  await new Promise(r=>setTimeout(r,200))
  await evaluate(`(()=>{const list=document.querySelector('#workspace-folders');[...list?.querySelectorAll(':scope > div > button')??[]].find(b=>b.textContent.startsWith('Z:')&&!b.hasAttribute('aria-pressed'))?.click()})()`)
  await new Promise(r=>setTimeout(r,100))
  const before=await evaluate(`(()=>{const list=document.querySelector('#workspace-folders');const row=list?.querySelector('div');const head=row?.querySelector('button');return {row:row?.className,head:head?.className,height:head?.getBoundingClientRect().height,location:document.querySelector('[class*="_pickerLocation_"]')?.textContent,scroll:list?.scrollTop,header:document.querySelector('header')?.textContent,rows:list?.textContent.slice(0,200)}})()`)
  console.log(JSON.stringify(before))
  if(!/^_pickerFolder_\w+$/.test(before.row)||!/^_workspaceHeader_\w+$/.test(before.head))throw Error('Workspace picker is not showing rows')
  const css=`.${before.row}:nth-child(even){background:var(--raised)}.${before.row}:hover{background:var(--hover)}.${before.row}>.${before.head}{padding-top:3px;padding-bottom:2px}`
  await evaluate(`(()=>{let style=document.getElementById('compact-workspace-picker');if(!style){style=document.createElement('style');style.id='compact-workspace-picker';document.head.append(style)}style.textContent=${JSON.stringify(css)}})()`)
  const after=await evaluate(`(()=>{const list=document.querySelector('#workspace-folders');const rows=[...list.children];const head=rows[0].querySelector('button');return {height:head.getBoundingClientRect().height,paddingTop:getComputedStyle(head).paddingTop,paddingBottom:getComputedStyle(head).paddingBottom,backgrounds:rows.slice(0,4).map(row=>getComputedStyle(row).backgroundColor),location:document.querySelector('[class*="_pickerLocation_"]')?.textContent}})()`)
  if(after.paddingTop!=='3px'||after.paddingBottom!=='2px'||before.location!==after.location)throw Error('Unexpected workspace picker layout')
  console.log(JSON.stringify({beforeHeight:before.height,...after}))
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/compact-workspace-picker-native.local.png',Buffer.from(shot.result.data,'base64'))
  await evaluate(`window.threadlight.setStayOpen(${Boolean(pinned)})`)
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
