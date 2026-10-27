const fs = require('node:fs')
const {fileURLToPath} = require('node:url')
;(async()=>{
 const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json()
 const ws=new WebSocket(targets.find(t=>t.url.includes('view=panel')).webSocketDebuggerUrl)
 try{
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
  const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
  const source=await evaluate(`({css:[...document.styleSheets].map(s=>s.href).find(h=>h?.includes('/assets/index-')),rowHeight:document.querySelector('[class*="_fileHead_"]')?.getBoundingClientRect().height})`)
  const cssPath=fileURLToPath(source.css)
  if(!/^z:\/general\/threadlight(?:-checklist-diff)?\/out\/renderer\/assets\//.test(cssPath.replaceAll('\\','/').toLowerCase()))throw Error('Unexpected built stylesheet')
  const original=fs.readFileSync(cssPath,'utf8')
  const row=original.match(/\.(_fileRow_\w+)/)?.[1],head=original.match(/\.(_fileHead_\w+)/)?.[1],expanded=original.match(/\.(_expanded_\w+)/)?.[1]
  if(!row||!head||!expanded)throw Error('Missing diff file styles')
  const changes=original.match(/\.(_changes_\w+)/)?.[1],block=original.match(/\.(_diffBlock_\w+)/)?.[1]
  if(!changes||!block)throw Error('Missing diff scroll regions')
  const override=`\n/* Compact diff rows and hidden scrollbars; source committed on main. */\n.${row}:nth-of-type(even){background:var(--raised)}\n.${row}.${expanded},.${row}:hover{background:var(--hover)}\n.${head}{padding:2.5px 10px}\n.${changes},.${block}{scrollbar-width:none}\n.${changes}::-webkit-scrollbar,.${block}::-webkit-scrollbar{display:none}\n`
  if(!original.includes(override))fs.appendFileSync(cssPath,override)
  await evaluate(`(()=>{let style=document.getElementById('compact-diff-file-rows');if(!style){style=document.createElement('style');style.id='compact-diff-file-rows';document.head.append(style)}style.textContent=${JSON.stringify(override)}})()`)
  const result=await evaluate(`(()=>{const heads=[...document.querySelectorAll('[class*="_fileHead_"]')];return {files:heads.length,rowHeight:heads[0]?.getBoundingClientRect().height,padding:heads[0]&&getComputedStyle(heads[0]).padding,backgrounds:heads.slice(0,4).map(h=>getComputedStyle(h.parentElement).backgroundColor)}})()`)
  console.log(JSON.stringify({beforeHeight:source.rowHeight,...result}))
  if(result.files&&result.padding!=='2.5px 10px')throw Error('Unexpected diff file padding')
  const scroll=await evaluate(`(()=>{const el=document.querySelector('.${changes}');if(!el)return null;return {top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,width:el.offsetWidth-el.clientWidth,style:getComputedStyle(el).scrollbarWidth,rect:el.getBoundingClientRect().toJSON()}})()`)
  if(scroll){
   if(scroll.style!=='none'||scroll.width!==0)throw Error('Scrollbar still occupies space')
   await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:scroll.rect.left+scroll.rect.width/2,y:scroll.rect.top+Math.min(100,scroll.rect.height/2),deltaX:0,deltaY:scroll.top>0?-100:100})
   await new Promise(r=>setTimeout(r,150))
   const next=await evaluate(`document.querySelector('.${changes}').scrollTop`)
   if(scroll.total>scroll.height&&next===scroll.top)throw Error('Wheel scrolling failed')
   await evaluate(`document.querySelector('.${changes}').scrollTop=${scroll.top}`)
   console.log(JSON.stringify({scrollbar:scroll.style,gutter:scroll.width,wheelScrollVerified:next!==scroll.top}))
  }
  const shot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('screenshots-local/compact-diff-files-native.local.png',Buffer.from(shot.result.data,'base64'))
 }finally{ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
