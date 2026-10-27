import { createContext, useContext } from 'react'
import type { Settings } from '../../shared/settings'

export type HelpMode = Settings['hoverHelp']
export const HelpModeContext = createContext<HelpMode>('info')
export const useHelpMode = () => useContext(HelpModeContext)
