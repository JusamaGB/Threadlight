/** Hide Windows' extended-length prefix in labels, preserving the real path for operations. */
export function displayWindowsPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return '\\\\' + path.slice(8)
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4)
  return path
}
