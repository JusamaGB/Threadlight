import { createContext, useContext, useMemo, useRef } from 'react'

/**
 * The panel window is sized to its card, so a pop-up that sticks out of the card would be cut
 * off. A pop-up asks for room instead: the window grows on its open side (below when it opens
 * down from the dot, above when it opens up) while the card stays where it is on screen.
 * Each pop-up has its own request and the window gets the largest, so two pop-ups open at
 * once (a menu and a hover hint) never cancel each other's.
 */
export interface PanelRoom {
  opensDown: boolean
  /** Extra pixels granted, never more than the screen allows. */
  extra: number
  reserve: (px: number) => void
}

/** What the panel provides: a request is made on behalf of one owner. */
export interface PanelRoomSource {
  opensDown: boolean
  extra: number
  reserve: (px: number, owner: object) => void
}

export const PanelRoomContext = createContext<PanelRoomSource>({
  opensDown: true,
  extra: 0,
  reserve: () => {},
})

export function usePanelRoom(): PanelRoom {
  const source = useContext(PanelRoomContext)
  // One stable owner for each pop-up that asks, for as long as it is on screen.
  const owner = useRef({})
  return useMemo(
    () => ({
      opensDown: source.opensDown,
      extra: source.extra,
      reserve: (px: number) => source.reserve(px, owner.current),
    }),
    [source],
  )
}
