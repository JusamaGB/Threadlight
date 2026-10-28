// Explicit opt-in: this test only answers the user-authorized disposable desktop chat.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import ts from 'typescript'
const loadSource = createRequire(import.meta.url)
loadSource.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { NativeCodexQuestions, nativeQuestionRef } = loadSource(
  '../../src/main/codex/nativeQuestions.ts',
)
const root = path.resolve(import.meta.dirname, '../..')
const threadId = '01a182bd-bc7e-77f2-a94e-2ee42f2709eb'
const history = path.join(process.env.USERPROFILE, '.codex', 'thread_history_1.sqlite')
const output = path.join(root, 'notes-local/native-cards-investigation')
async function main() {
  assert.equal(process.env.THREADLIGHT_NATIVE_PROOF, '1', 'Explicit live test opt-in required')
  const db = new DatabaseSync(history, { readOnly: true })
  db.exec('PRAGMA query_only=ON')
  try {
    const turn = db
      .prepare(
        'SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
      )
      .get(threadId)
    assert.equal(turn.status, 'inProgress')
    const read = () =>
      db
        .prepare(
          'SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? ORDER BY rollout_ordinal',
        )
        .all(threadId, turn.turn_id)
        .map((r) => JSON.parse(r.item_json))
    const records = read(),
      ref = nativeQuestionRef(records, turn.turn_id)
    const card = records.find((r) => r.id === ref?.itemId)
    assert.deepEqual(
      card.questions.map((q) => q.title),
      [
        'Threadlight native integration proof: choose a sample',
        'Threadlight native integration proof: add a note',
      ],
    )
    const answers = ['Green sample', 'Free text reaches the same turn.']
    const service = new NativeCodexQuestions(history, path.join(output, 'live-receipts'))
    const started = Date.now()
    const result = await service.answer(`codex:${threadId}`, ref, answers)
    const report = {
      threadId,
      reference: ref,
      answers,
      result,
      latencyMs: Date.now() - started,
      acceptedInOriginalTurn: false,
    }
    fs.writeFileSync(path.join(output, 'integration-proof.json'), JSON.stringify(report, null, 2))
    assert.equal(result.ok, true)
    for (let n = 0; n < 80; n++) {
      const accepted = read()
        .filter((r) => r.type === 'userMessage')
        .flatMap((r) => r.content || [])
        .filter((c) => c.type === 'text' && c.text.includes(ref.itemId))
      if (accepted.length) {
        assert.equal(accepted.length, 1)
        const replies = JSON.parse(
          accepted[0].text
            .trim()
            .match(
              /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>$/,
            )[1],
        )
        assert.deepEqual(
          replies.map((r) => r.answer),
          answers,
        )
        assert.deepEqual(
          replies.map((r) => r.questionItemId),
          answers.map((_, i) => JSON.stringify(['request_user_input_async', ref.itemId, i])),
        )
        report.acceptedInOriginalTurn = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    report.duplicateBlocked = !(await service.answer(`codex:${threadId}`, ref, answers)).ok
    fs.writeFileSync(path.join(output, 'integration-proof.json'), JSON.stringify(report, null, 2))
    assert.equal(report.acceptedInOriginalTurn, true)
    assert.equal(report.duplicateBlocked, true)
    console.log(JSON.stringify(report))
  } finally {
    db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
