import { providerName, sessionProvider } from '../../shared/providers'
import styles from './Panel.module.css'

export function ProviderBadge({ id }: { id: string }) {
  const name = providerName(sessionProvider(id))
  return (
    <span className={styles.providerBadge} title={`${name} chat`}>
      {name}
    </span>
  )
}
