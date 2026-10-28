import { useEffect, useLayoutEffect, useRef } from 'react'
import type {
  AppliedRoute,
  ControlCommand,
  ControlHello,
  ControlPublication,
} from '../../shared/appControl'

/** Publish after React commits; never acknowledge merely receiving an IPC message. */
export function useAppControl(
  route: AppliedRoute,
  pinned: boolean,
  apply: (command: ControlCommand) => boolean,
  readiness: 'ready' | 'loading' | 'unavailable' = 'ready',
) {
  const state = useRef({ route, pinned, apply, readiness })
  const connection = useRef<ControlHello | null>(null)
  const revision = useRef(0)
  const pending = useRef<{
    command: ControlCommand
    outcome: ControlPublication['outcome']
    committed: boolean
  } | null>(null)
  useLayoutEffect(() => {
    state.current = { route, pinned, apply, readiness }
  })
  useEffect(() => {
    if (!window.threadlight.controlHello) return
    let live = true
    let connecting = false
    const connect = () => {
      if (connecting || connection.current || !live) return
      connecting = true
      void window.threadlight
        .controlHello()
        .then((hello) => {
          if (live && hello) {
            connection.current = hello
            publish()
          }
        })
        .catch(() => {
          /* Main may still be registering services during startup. */
        })
        .finally(() => {
          connecting = false
        })
    }
    const publish = () => {
      if (!live) return
      if (!connection.current) {
        connect()
        return
      }
      const request = pending.current
      const expired = request && request.command.expiresAt <= Date.now()
      const expected = request?.command.route
      const routePending =
        request?.outcome === 'ok' &&
        expected &&
        !Object.entries(expected).every(
          ([key, value]) =>
            key === 'threadId' ||
            (state.current.route as unknown as Record<string, unknown>)[key] === value,
        )
      if (
        request &&
        !expired &&
        (!request.committed || state.current.readiness === 'loading' || routePending)
      ) {
        setTimeout(publish, 50)
        return
      }
      window.threadlight.controlPublish({
        ...connection.current,
        snapshot: {
          route: state.current.route,
          pinned: state.current.pinned,
          open: document.visibilityState === 'visible',
          observedAt: Date.now(),
          revision: ++revision.current,
        },
        ...(!expired && request
          ? {
              commandId: request.command.commandId,
              outcome: state.current.readiness === 'unavailable' ? 'unavailable' : request.outcome,
            }
          : {}),
      })
      pending.current = null
    }
    connect()
    const stop = window.threadlight.onControlCommand((command) => {
      if (
        !connection.current ||
        command.instanceId !== connection.current.instanceId ||
        command.generation !== connection.current.generation ||
        command.expiresAt <= Date.now()
      )
        return
      void window.threadlight.controlClaim(command).then((allowed) => {
        if (!allowed || !live || command.expiresAt <= Date.now()) return
        const applied = state.current.apply(command)
        pending.current = { command, outcome: applied ? 'ok' : 'not_found', committed: false }
        // Two animation frames place publication after the next committed layout and nested views.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (pending.current?.command.commandId === command.commandId)
              pending.current.committed = true
            publish()
          }),
        )
      })
    })
    const timer = setInterval(publish, 3000)
    return () => {
      live = false
      stop()
      clearInterval(timer)
      connection.current = null
    }
  }, [])
  useEffect(() => {
    if (connection.current && !pending.current)
      window.threadlight.controlPublish({
        ...connection.current,
        snapshot: {
          route,
          pinned,
          open: document.visibilityState === 'visible',
          observedAt: Date.now(),
          revision: ++revision.current,
        },
      })
  }, [route, pinned])
}
