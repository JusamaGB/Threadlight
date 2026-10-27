const fs = require('node:fs')
;(async () => {
  const tabs = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const ws = new WebSocket(tabs.find(t => t.url.includes('view=panel')).webSocketDebuggerUrl)
  let evaluate, prior
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let id = 0
    const pending = new Map()
    ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
    const call = (method, params) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
    evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value }
    const delay = ms => new Promise(r => setTimeout(r, ms))
    prior = await evaluate(`(async()=>({agent:await window.threadlight.getAgent(),motion:await window.threadlight.getMotion(),view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label^="Pinned open"]'),settings:await window.threadlight.getSettings()}))()`)
    if (prior.agent.status !== 'idle' || prior.agent.live || prior.motion.mode === 'listening' || prior.motion.input.level > 0.01) throw Error('Agent/voice active')
    if (!prior.view) throw Error('A subpage is open; defer renderer refresh')
    if (prior.settings.hoverHelp !== 'info') await evaluate(`window.threadlight.updateSettings({hoverHelp:'info'})`)
    await call('Page.reload', { ignoreCache: true })
    await delay(900)
    await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
    const choose = async name => {
      const view = await evaluate(`document.querySelector('[data-thread-view]')?.dataset.threadView`)
      if (view === name.toLowerCase()) return
      await evaluate(`document.querySelector('[data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:12}))`)
      await delay(100)
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()===${JSON.stringify(name)})?.click()`)
      await delay(250)
    }
    const sizes = () => evaluate(`(()=>{const bars=[...document.querySelectorAll('[class*="_usage_"]')];return {height:document.querySelector('[data-card]').getBoundingClientRect().height,top:bars[0]?.getBoundingClientRect().y,bottom:bars.at(-1)?.getBoundingClientRect().y,message:document.querySelector('[data-hover-message]')?.innerText,tooltips:document.querySelectorAll('[data-hover-message] [role="tooltip"]').length}})()`)
    const hoverDiff = async () => {
      const p = await evaluate(`(()=>{const e=document.querySelector('[class*="_usage_"]');if(!e)throw Error('No usage bar');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y})
      const frames = await evaluate(`new Promise(resolve=>{const result=[],start=performance.now();const frame=()=>{const bars=[...document.querySelectorAll('[class*="_usage_"]')];result.push({height:document.querySelector('[data-card]').getBoundingClientRect().height,native:innerHeight,top:bars[0].getBoundingClientRect().y,bottom:bars.at(-1).getBoundingClientRect().y});if(performance.now()-start<300)requestAnimationFrame(frame);else resolve(result)};requestAnimationFrame(frame)})`)
      await delay(200)
      return frames
    }
    const capture = async name => {const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`screenshots-local/${name}.local.png`,Buffer.from(r.result.data,'base64'))}
    const results={}
    for(const view of ['Recent','Workspace']) {
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:125,y:12})
      await choose(view)
      await delay(350)
      if(view==='Workspace') for(let n=0;n<50;n++) {
        if(await evaluate(`(()=>{const e=document.querySelector('[data-card]');return e.getBoundingClientRect().height>=parseFloat(getComputedStyle(e).maxHeight)-1})()`))break
        await delay(100)
      }
      const before=await sizes()
      const frames = await hoverDiff()
      const after=await sizes()
      if(after.tooltips!==1)throw Error('Hint not docked '+JSON.stringify(after))
      if(view==='Recent'&&!(after.height>before.height&&after.bottom>before.bottom))throw Error('Recent did not grow')
      if(view==='Workspace'&&!(after.height===before.height&&after.bottom===before.bottom&&after.top<before.top))throw Error('Workspace did not reveal upward '+JSON.stringify({before,after}))
      const moving = new Set(frames.map(f=>Math.round((view==='Recent'?f.height:f.top)*10))).size
      const nativeSizes = new Set(frames.map(f=>f.native)).size
      if(moving<3)throw Error('No intermediate animation frames: '+JSON.stringify(frames))
      if(view==='Recent'&&nativeSizes<3)throw Error('Native window did not follow the animation')
      results[view]={before,after,movingFrames:moving,nativeSizes}
      fs.writeFileSync('screenshots-local/hover-motion-native-results.local.json',JSON.stringify(results))
      await capture(`footer-hint-${view.toLowerCase()}-native`)
    }
    console.log(JSON.stringify(results))
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:125,y:12})
    await choose(prior.view[0].toUpperCase()+prior.view.slice(1))
    if(prior.pinned&&!await evaluate(`!!document.querySelector('header button[aria-label^="Pinned open"]')`))await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`)
    await evaluate(`window.threadlight.setStayOpen(${prior.pinned})`)
  } finally {
    if(prior&&evaluate)await evaluate(`window.threadlight.updateSettings({listMode:${JSON.stringify(prior.settings.listMode)},hoverHelp:${JSON.stringify(prior.settings.hoverHelp??'info')}});if(${prior.pinned}&&!document.querySelector('header button[aria-label^="Pinned open"]'))document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));window.threadlight.setStayOpen(${prior.pinned})`)
    ws.close()
  }
})().catch(e=>{console.error(e);process.exitCode=1})
