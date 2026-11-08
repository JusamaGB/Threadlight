export function memoryAuthFile(): string
export function readMemoryKey(): Buffer
export function memoryEndpoint(endpoint: string): URL
export function memoryPost(
  endpoint: string,
  body: unknown,
  secret: string | undefined,
  key: Buffer,
  timeout?: number,
): Promise<{ status: number; value?: unknown }>
