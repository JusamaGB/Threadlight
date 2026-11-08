// Disposable model provider for exercising the real VS Code model and completion APIs.
const vscode = require('vscode')
function activate(context) {
  let cancelled = 0,
    requests = 0
  const provider = {
    async provideLanguageModelChatInformation() {
      return [
        {
          id: 'coach-fixture',
          name: 'Coach fixture model',
          family: 'fixture',
          version: '1',
          maxInputTokens: 8192,
          maxOutputTokens: 1024,
          capabilities: {},
        },
      ]
    },
    async provideTokenCount(_model, value) {
      return Math.ceil(JSON.stringify(value).length / 4)
    },
    async provideLanguageModelChatResponse(_model, messages, _options, progress, token) {
      const prompt = messages.flatMap((m) => m.content.map((p) => p.value)).join('\n')
      requests++
      console.log('Fixture request', prompt.slice(0, 70))
      const sub = token.onCancellationRequested(() => cancelled++)
      try {
        const reply = prompt.includes('Reply with OK')
          ? 'OK'
          : prompt.includes('predict one directly related')
            ? '{"line":2,"column":0,"oldText":"breakpoint()","newText":""}'
            : prompt.includes('provider_failure')
              ? undefined
              : prompt.includes('model_delay')
                ? ' never_display_stale'
                : prompt.includes('partial_value = ')
                  ? 'result + 1'
                  : '\n    return result'
        if (reply === undefined) throw Error('Fixture provider is offline')
        if (reply.includes('stale')) await new Promise((r) => setTimeout(r, 650))
        progress.report(new vscode.LanguageModelTextPart(reply))
      } finally {
        sub.dispose()
      }
    },
  }
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('threadlight-test', provider),
  )
  return { stats: () => ({ requests, cancelled }) }
}
module.exports = { activate }
