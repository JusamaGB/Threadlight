const fs = require('node:fs')
;(async()=>{
 const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(targets.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
  let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  const source=await call('Runtime.evaluate',{expression:`({headerClass:document.querySelector('header').className,gearClass:document.querySelector('header [aria-label="Settings"]').classList[0],css:[...document.styleSheets].map(s=>s.href).find(h=>h?.includes('/assets/index-'))})`,returnByValue:true})
  const {headerClass,gearClass,css}=source.result.result.value
  if(!/^_header_[a-zA-Z0-9_]+$/.test(headerClass))throw Error('Unexpected header class')
  if(!/^_gear_[a-zA-Z0-9_]+$/.test(gearClass))throw Error('Unexpected gear class')
  const cssPath=require('node:url').fileURLToPath(css)
  if(!cssPath.replaceAll('\\','/').toLowerCase().startsWith('z:/general/threadlight/out/renderer/assets/'))throw Error('Unexpected built stylesheet')
  const override=`\n/* Header action spacing hotfix; source committed on main. */\n.${headerClass}{padding-right:3px}\n.${headerClass}>.${gearClass}+.${gearClass}{margin-left:-4px}\n`
  if(!fs.readFileSync(cssPath,'utf8').includes(override))fs.appendFileSync(cssPath,override)
  await call('Runtime.evaluate',{expression:`(()=>{let style=document.getElementById('header-action-spacing-hotfix');if(!style){style=document.createElement('style');style.id='header-action-spacing-hotfix';document.head.append(style)}style.textContent=${JSON.stringify(override)}})()`})
  const result=await call('Runtime.evaluate',{expression:`(()=>{const header=document.querySelector('header');const gear=header.querySelector('[aria-label="Settings"]');const agent=gear.previousElementSibling;const rect=el=>el.getBoundingClientRect();return {rightPadding:getComputedStyle(header).paddingRight,rightGap:rect(header).right-rect(gear).right,iconGap:rect(gear).left-rect(agent).right,visibleIconGap:rect(gear.querySelector('svg')).left-rect(agent.querySelector('svg')).right,visibleRightBuffer:rect(header).right-rect(gear.querySelector('svg')).right,headerWidth:rect(header).width}})()`,returnByValue:true})
  if(result.result.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails))
  const value=result.result.result.value;console.log(JSON.stringify(value))
  if(value.rightPadding!=='3px'||value.visibleIconGap!==value.visibleRightBuffer)throw Error('Unexpected header icon spacing')
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/header-icons-right.local.png',Buffer.from(shot.result.data,'base64'))
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
