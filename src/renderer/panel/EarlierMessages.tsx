import styles from './ThreadConversation.module.css'

/** History boundary shared by code and ordinary account conversations. */
export function EarlierMessages({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  return (
    <button
      type="button"
      data-history-boundary=""
      className={styles.older}
      disabled={loading}
      onClick={onLoad}
    >
      {loading ? 'Loading earlier messages…' : '↑ Load earlier messages'}
    </button>
  )
}
