import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Dot } from './dot/Dot'
import './theme.css'

// Each window loads this page with ?view=… and renders only its own piece.
const view = new URLSearchParams(window.location.search).get('view') ?? 'dot'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(<StrictMode>{view === 'dot' ? <Dot working={false} /> : null}</StrictMode>)
