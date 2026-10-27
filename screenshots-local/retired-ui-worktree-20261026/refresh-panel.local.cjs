async function run() {
  const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const target = targets.find(t => t.url.includes('view=panel'))
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let id = 0
    const pending = new Map()
    ws.onmessage = event => {
      const message = JSON.parse(event.data)
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
    const call = (method, params) => new Promise(resolve => {
      const key = ++id
      pending.set(key, resolve)
      ws.send(JSON.stringify({ id: key, method, params }))
    })
    const evaluate = async expression => {
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.result?.exceptionDetails) throw Error(JSON.stringify(response.result.exceptionDetails))
      return response.result.result.value
    }
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    const prior = await evaluate(`(()=>{const picker=document.querySelector('header')?.textContent.includes('Choose workspace');return {picker,settingsPage:document.querySelector('header')?.textContent.includes('Settings'),view:document.querySelector('header [data-thread-view]')?.dataset.threadView ?? (picker?'workspace':undefined),pinned:!!document.querySelector('header button[aria-label="Unpin"]'),expanded:[...document.querySelectorAll('[data-session-id]')].find(el=>el.querySelector(':scope > button[aria-expanded="true"]'))?.dataset.sessionId}})()`)
    if (prior.settingsPage) {
      await evaluate(`document.querySelector('header button[aria-label="Back to sessions"]')?.click()`)
      await delay(100)
      Object.assign(prior, await evaluate(`({view:document.querySelector('header [data-thread-view]')?.dataset.threadView,pinned:!!document.querySelector('header button[aria-label="Unpin"]')})`))
    }
    await call('Page.reload', { ignoreCache: true })
    await delay(900)
    if (prior.view && prior.view !== 'active') {
      await evaluate(`document.querySelector('header [data-thread-view]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:12}))`)
      await delay(100)
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().toLowerCase()===${JSON.stringify(prior.view)})?.click()`)
      await delay(500)
    }
    if (prior.pinned) await evaluate(`document.querySelector('header').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))`)
    if (prior.expanded) await evaluate(`[...document.querySelectorAll('[data-session-id]')].find(el=>el.dataset.sessionId===${JSON.stringify(prior.expanded)})?.querySelector(':scope > button[aria-expanded="false"]')?.click()`)
    if (prior.picker) { await evaluate(`document.querySelector('header button[aria-label^="Choose workspace:"]')?.click()`); await delay(250) }
    if (prior.settingsPage) { await evaluate(`document.querySelector('header button[aria-label="Settings"]')?.click()`); await delay(150) }
    const result = await evaluate(`(()=>{const area=document.querySelector('[class*="_workspaceResizeArea_"]');return {view:document.querySelector('[data-thread-view]')?.dataset.threadView,area:area?.getBoundingClientRect().toJSON(),resizeButtons:area?.querySelectorAll('button,svg').length,padding:area&&getComputedStyle(area).padding,cursor:area&&getComputedStyle(area).cursor,asset:document.querySelector('script[type="module"]').src}})()`)
    console.log(JSON.stringify(result))
  } finally { ws.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
