import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { controlRouteSchema, type ControlPublication } from '../../shared/appControl'
import type { AppControlService } from './service'

const publication = z
  .object({
    instanceId: z.string().uuid(),
    generation: z.string().uuid(),
    commandId: z.string().uuid().optional(),
    outcome: z.enum(['ok', 'not_found', 'unavailable']).optional(),
    snapshot: z
      .object({
        route: controlRouteSchema,
        revision: z.number().int().nonnegative(),
        observedAt: z.number(),
        open: z.boolean(),
        pinned: z.boolean(),
      })
      .strict(),
  })
  .strict()
export function registerAppControl(panel: BrowserWindow, service: AppControlService) {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.sender === panel.webContents && event.senderFrame === panel.webContents.mainFrame
  ipcMain.handle('control:hello', (event) => (trusted(event) ? service.hello() : null))
  ipcMain.handle(
    'control:claim',
    (event, value) => trusted(event) && !!value && service.claim(value),
  )
  ipcMain.on('control:publish', (event, value) => {
    if (!trusted(event)) return
    const parsed = publication.safeParse(value)
    if (parsed.success) service.publish(parsed.data as ControlPublication)
  })
  panel.webContents.on('did-start-loading', () => service.rendererGone())
  panel.webContents.on('render-process-gone', () => service.rendererGone())
  panel.once('closed', () => service.rendererGone())
}
