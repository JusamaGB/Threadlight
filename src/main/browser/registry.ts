import type { BrowserCommand, BrowserReply } from '../../shared/browser'

export interface BrowserCaller {
  id: string
  label: string
  hosted?: boolean
  valid(): boolean
}
export interface BrowserAccess {
  call(caller: BrowserCaller, command: BrowserCommand): Promise<BrowserReply>
}
let browser: BrowserAccess | undefined
export function setBrowserAccess(value: BrowserAccess | undefined) {
  browser = value
}
export async function callBrowser(
  caller: BrowserCaller,
  command: BrowserCommand,
): Promise<BrowserReply> {
  return browser ? browser.call(caller, command) : { ok: false, reason: 'Browser unavailable.' }
}
export function browserContent(value: BrowserReply) {
  const { jpeg, ...data } = value
  return {
    content: [
      { type: 'text', text: JSON.stringify(data) },
      ...(jpeg ? [{ type: 'image', mimeType: 'image/jpeg', data: jpeg }] : []),
    ],
    isError: !value.ok,
  }
}
