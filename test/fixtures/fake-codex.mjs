let message = ''
for await (const chunk of process.stdin) message += chunk
if (message === 'conflict') {
  process.stderr.write('thread-store conflict: thread already has an active writer')
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: process.argv.at(-2) }))
  console.log(JSON.stringify({ type: 'turn.started' }))
  console.log(
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: message } }),
  )
  console.log(JSON.stringify({ type: 'turn.completed' }))
}
