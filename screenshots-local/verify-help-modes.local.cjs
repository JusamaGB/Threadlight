const fs = require('node:fs')
;(async () => {
  const prior = JSON.parse(fs.readFileSync('screenshots-local/help-modes-prior.local.json', 'utf8'))
  const tabs = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const ws = new WebSocket(tabs.find(t => t.url.includes('view=panel')).webSocketDebuggerUrl)
  let evaluate
  try {
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
    let id=0;const pending=new Map()
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
    const call=(method,params)=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}))})
    evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
    const delay=ms=>new Promise(r=>setTimeout(r,ms))
    const settings=await evaluate('window.threadlight.getSettings()')
    if(!['info','tour','off'].includes(settings.hoverHelp))throw Error('Hover help unavailable'); await evaluate('window.threadlight.updateSettings({hoverHelp: '+JSON.stringify(prior.settings.hoverHelp ?? 'info')+'})')
    await evaluate('window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()')
    const chooseView=async view=>{
      if(await evaluate(`document.querySelector('[data-thread-view]')?.dataset.threadView`)===view)return
      await evaluate(`document.querySelector('[data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:12}))`)
      await delay(80)
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().toLowerCase()===${JSON.stringify(view)})?.click()`)
      await delay(150)
    }
    await chooseView(prior.view)
    const select=async mode=>{
      await evaluate(`document.querySelector('header button[aria-label="Settings"]').click()`)
      await delay(80)
      await evaluate(`[...document.querySelectorAll('[role="radio"]')].find(e=>e.textContent.toLowerCase()===${JSON.stringify(mode)}).click()`)
      for(let n=0;n<30;n++){if(await evaluate(`(async()=>(await window.threadlight.getSettings()).hoverHelp===${JSON.stringify(mode)})()`))break;await delay(50)}
      if(await evaluate(`(async()=>(await window.threadlight.getSettings()).hoverHelp)()`)!==mode)throw Error('Setting did not save: '+mode)
    }
    const back=()=>evaluate(`document.querySelector('header button[aria-label="Back to sessions"]').click()`)
    const hoverSettings=async()=>{ await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:120,y:12}); await delay(80)
      const point=await evaluate(`(()=>{const r=document.querySelector('header button[aria-label="Settings"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
      await delay(120)
      return evaluate(`({count:document.querySelectorAll('[role="tooltip"]').length,text:document.querySelector('[role="tooltip"]')?.textContent,title:document.querySelector('header button[aria-label="Settings"]').getAttribute('title')})`)
    }
    await select('tour')
    await evaluate(`[...document.querySelectorAll('[role="radio"]')].find(e=>e.textContent==='Tour').scrollIntoView({block:'center'})`)
    const shot=await call('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync('screenshots-local/help-modes-settings-native.local.png',Buffer.from(shot.result.data,'base64'))
    await back();await delay(100)
    const tour=await hoverSettings()
    if(tour.count!==1||tour.text!=='Settings'||tour.title!=='')throw Error('Native Tour failure '+JSON.stringify(tour))
    await select('off');await back();await delay(80)
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:120,y:12})
    const off=await hoverSettings()
    if(off.count!==0||off.title!=='')throw Error('Native Off failure '+JSON.stringify(off))
    await select('info');await back();await delay(80)
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:120,y:12})
    const info=await evaluate(`({title:document.querySelector('header button[aria-label="Settings"]').getAttribute('title'),count:document.querySelectorAll('[role="tooltip"]').length})`)
    if(info.title!=='Settings'||info.count!==0)throw Error('Native Info failure '+JSON.stringify(info))
    await chooseView(prior.view)
    const pinned=await evaluate(`!!document.querySelector('header button[aria-label^="Pinned open"]')`)
    if(pinned!==prior.pinned)await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`)
    await evaluate(`window.threadlight.setStayOpen(${prior.pinned})`)
    console.log(JSON.stringify({tour,off,info,restored:await evaluate(`(async()=>({mode:(await window.threadlight.getSettings()).hoverHelp,view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label^="Pinned open"]')}))()`)}))
  } finally { ws.close() }
})().catch(e=>{console.error(e);process.exitCode=1})
