const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('C:/Users/krisd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 try{
  const page=await browser.newPage({viewport:{width:480,height:500}})
  await page.goto('http://127.0.0.1:5186/connected-header.html')
  await page.waitForFunction(()=>!!window.headerMotionPreview)
  const canvas=page.locator('.motion canvas')
  const energy=async(level)=>page.evaluate(level=>{const input=document.querySelector('#energy');input.value=String(level);input.dispatchEvent(new Event('input',{bubbles:true}))},level)
  for(const progress of [0,0.3,0.7,0.99]){
   await page.evaluate(progress=>window.headerMotionPreview.seek(progress,2),progress)
   await energy(0)
   const quiet=await canvas.screenshot()
   await energy(1)
   assert.deepEqual(await canvas.screenshot(),quiet,`audio changed opening at ${progress}`)
  }
  await page.screenshot({path:'screenshots-local/waveform-opening-quiet.local.png'})
  await page.evaluate(()=>window.headerMotionPreview.seek(1,2))
  await energy(0)
  const quiet=await canvas.screenshot()
  await energy(1)
  assert.notDeepEqual(await canvas.screenshot(),quiet,'full-width waveform did not react to audio')
  await page.screenshot({path:'screenshots-local/waveform-open-audio.local.png'})
  console.log('PASS: rendered transition unchanged from zero to maximum energy at every partial width; full-width waveform responds.')
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
