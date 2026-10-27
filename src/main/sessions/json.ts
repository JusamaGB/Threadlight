// Small helpers for reading JSON whose shape we do not control.

export type JsonObject = Record<string, unknown>

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Collapses all whitespace runs to single spaces. */
export function oneLine(text: string | null | undefined): string {
  return (text ?? '').split(/\s+/).filter(Boolean).join(' ')
}
