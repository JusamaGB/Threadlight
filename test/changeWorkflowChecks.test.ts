import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { runProjectCheck } from '../src/main/changeWorkflowChecks'

it('rejects shell syntax and stops a timed-out check including its child process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-check-timeout-'))
  try {
    await expect(runProjectCheck(root, 'test & echo unsafe', process.env)).rejects.toThrow(
      'Invalid',
    )
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node check.cjs' } }),
    )
    await writeFile(
      join(root, 'check.cjs'),
      `
      require('child_process').spawn(process.execPath, ['-e',
        "setInterval(()=>require('fs').writeFileSync('pulse',String(Date.now())),100)"
      ], {stdio:'inherit'});
      setInterval(()=>{},1000);
    `,
    )
    await expect(runProjectCheck(root, 'test', process.env, 8000)).rejects.toThrow('timed out')
    const stopped = await readFile(join(root, 'pulse'), 'utf8')
    await delay(600)
    expect(await readFile(join(root, 'pulse'), 'utf8')).toBe(stopped)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20000)
