import { registerHooks } from 'node:module'
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (!url.endsWith('/test/ui/providers.smoke.mjs')) return result
  const extra = `
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const originalContextSession = await page.evaluate(async () => (await window.threadlight.getSnapshot()).sessions.find(session => session.provider === 'codex'))
  await page.evaluate(() => window.proof.patch({ state: 'working', thinking: true, attention: null, contextUsed: 0.67 }))
  const thinkingRing = page.locator('[data-session-id="codex:11111111-1111-4111-8111-111111111111"] svg[data-thinking]')
  await thinkingRing.waitFor()
  const arcBefore = await thinkingRing.locator('circle').last().getAttribute('stroke-dashoffset')
  assert.match(await thinkingRing.evaluate(element => getComputedStyle(element).animationName), /contextThinking/)
  await capture('context-wheel-thinking')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await thinkingRing.evaluate(element => getComputedStyle(element).animationName), 'none')
  assert.equal(await thinkingRing.locator('circle').last().getAttribute('stroke-dashoffset'), arcBefore)
  await page.evaluate(() => window.proof.patch({ thinking: false }))
  await page.waitForFunction(() => !document.querySelector('[data-session-id="codex:11111111-1111-4111-8111-111111111111"] svg[data-thinking]'))
  const stillRing = page.locator('[data-session-id="codex:11111111-1111-4111-8111-111111111111"] svg[class*="contextRing"]')
  assert.equal(await stillRing.locator('circle').last().getAttribute('stroke-dashoffset'), arcBefore)
  await page.evaluate(session => window.proof.patch(session), originalContextSession)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  console.log('PASS: thinking reuses the context arc, preserves its fill and stops for reduced motion or idle.')
`
  return {...result, source: result.source.toString().replace('  await checkNowTimer(page, row)', '  await checkNowTimer(page, row)' + extra)}
}})
await import('../test/ui/providers.smoke.mjs')
