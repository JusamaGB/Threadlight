const fs = require('node:fs')
;(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const ws = new WebSocket(targets.find((t) => t.url.includes('view=panel')).webSocketDebuggerUrl)
  try {
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    let id = 0
    const pending = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
    const call = (method, params) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id:n, method, params})) })
    const evaluate = async (expression) => {
      const r = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true})
      if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails))
      return r.result.result.value
    }
    const delay = (ms) => new Promise((r) => setTimeout(r, ms))
    const prior = await evaluate(`({settings:document.querySelector('header')?.textContent.includes('Settings'),view:document.querySelector('[data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label="Unpin"]')})`)
    await call('Page.reload', {ignoreCache:true})
    await delay(1000)
    await evaluate(`window.threadlight.setStayOpen(true);window.threadlight.openPanelQuietly()`)
    if (prior.view && prior.view !== 'active') {
      await evaluate(`document.querySelector('header [data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:12}))`)
      await delay(100)
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().toLowerCase()===${JSON.stringify(prior.view)})?.click()`)
      await delay(300)
    }
    await evaluate(`document.querySelector('header button[aria-label="Settings"]')?.click()`)
    await delay(200)
    await evaluate(`(()=>{const p=[...document.querySelectorAll('p')].find(p=>p.textContent.includes('Not made by'));p.parentElement.scrollTop=p.parentElement.scrollHeight})()`)
    await delay(200)
    const result = await evaluate(`(()=>{const p=[...document.querySelectorAll('p')].find(p=>p.textContent.includes('Not made by'));const row=p.previousElementSibling.lastElementChild;return {text:p.innerText,align:getComputedStyle(p).textAlign,marginTop:getComputedStyle(p).marginTop,gap:p.getBoundingClientRect().top-row.getBoundingClientRect().bottom,cardWidth:document.querySelector('[data-card]').getBoundingClientRect().width}})()`)
    console.log(JSON.stringify(result))
    if(result.align!=='center'||result.marginTop!=='0px'||result.gap>2)throw Error('Unexpected footer layout')
    const shot=await call('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync('screenshots-local/settings-footer-centered.local.png',Buffer.from(shot.result.data,'base64'))
    if(!prior.settings)await evaluate(`document.querySelector('header button[aria-label="Back to sessions"]')?.click()`)
    await evaluate(`window.threadlight.setStayOpen(${Boolean(prior.pinned)})`)
  } finally { ws.close() }
})().catch((e)=>{console.error(e);process.exitCode=1})
