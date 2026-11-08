export function callHook(
  port: number,
  path: string,
  seconds: number,
  body: string,
  key: Buffer,
): Promise<string>
export function run(args?: string[]): Promise<void>
