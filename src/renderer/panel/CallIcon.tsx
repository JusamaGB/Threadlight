export type CallAction = 'start' | 'end' | 'mic' | 'speaker' | 'stop' | 'cancel'
export function CallIcon({ action, muted = false }: { action: CallAction; muted?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {action === 'start' && (
        <path d="m6 3 3 4-2 2c1 3 5 7 8 8l2-2 4 3c-1 4-3 4-5 3C9 18 4 13 2 6c0-2 2-3 4-3Z" />
      )}
      {action === 'cancel' && <path d="m6 6 12 12M18 6 6 18" />}
      {action === 'end' && <path d="M2 15c0-7 20-7 20 0v3h-5l-1-4a13 13 0 0 0-8 0l-1 4H2Z" />}
      {action === 'mic' && (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" />
        </>
      )}
      {action === 'speaker' && <path d="M3 9h4l6-5v16l-6-5H3ZM16 8q4 4 0 8m3-11q7 7 0 14" />}
      {action === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />}
      {muted && (
        <>
          <path d="m3 3 18 18" stroke="var(--bg)" strokeWidth="4.5" />
          <path d="m3 3 18 18" />
        </>
      )}
    </svg>
  )
}
