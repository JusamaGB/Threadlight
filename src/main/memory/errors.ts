export class MemoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
