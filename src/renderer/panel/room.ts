import { createContext, useContext } from 'react'

/**
 * The panel window is sized to its card, so a pop-up that sticks out of the card would be cut
 * off. A pop-up asks for room instead: the window grows on its open side (below when it opens
 * down from the dot, above when it opens up) while the card stays where it is on screen.
 */
export interface PanelRoom {
  opensDown: boolean
  /** Extra pixels granted, never more than the screen allows. */
  extra: number
  reserve: (px: number) => void
}

export const PanelRoomContext = createContext<PanelRoom>({
  opensDown: true,
  extra: 0,
  reserve: () => {},
})

export const usePanelRoom = () => useContext(PanelRoomContext)
