import { registerHooks } from 'node:module'
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (!url.endsWith('/test/ui/voice-routing.smoke.mjs')) return result
  return {...result, source: result.source.toString().replace('  const agentSends = () =>', `
  await checkVoiceTarget(page)
  await page.evaluate(() => {
    window.RTCPeerConnection = window.proof.nativePeer
    AudioContext.prototype.createScriptProcessor = window.proof.createProcessor
  })
  await page.evaluate(() => window.proof.agent({ status: 'idle', provider: null, items: [] }))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  console.log('PASS: focused Agent/thread microphone targets and inactive-microphone placement.')
  return
  const agentSends = () =>`)}
}})
await import('../test/ui/providers.smoke.mjs')
