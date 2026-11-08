import { savedBy, type MemorySaver } from '../../shared/memory'
import type { Session } from '../../shared/types'

export function SaverAttribution({ saver, sessions }: { saver: MemorySaver; sessions: Session[] }) {
  const chat = sessions.find((s) => s.id === saver.chatId)
  return (
    <p>
      {savedBy(saver)} · {new Date(saver.at).toLocaleString()}
      {saver.chatId && (
        <>
          {' '}
          · Source chat:{' '}
          {chat?.appId ? (
            <button
              title={saver.chatId}
              onClick={() => window.threadlight.openInClaude(chat.appId!)}
            >
              {chat.title || saver.chatId}
            </button>
          ) : (
            saver.chatId
          )}
        </>
      )}
    </p>
  )
}
