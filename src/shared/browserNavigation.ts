/** Resolve address-bar input without guessing single-word hostnames. */
export function browserUrl(input: string) {
  const value = input.trim()
  if (!value) throw Error('Enter a website address or search.')
  const hasScheme =
    /^[a-z][a-z\d+.-]*:/i.test(value) &&
    !/^(localhost|[^\s/:]+\.[^\s/:]+):\d+(?:[/?#]|$)/i.test(value)
  const address = /^(?:localhost|\[[a-f\d:]+\]|[^\s/:]+\.[^\s/:]+)(?::\d+)?(?:[/?#][^\s]*)?$/i.test(
    value,
  )
  if (!hasScheme && !address) return `https://www.google.com/search?q=${encodeURIComponent(value)}`
  const url = new URL(
    hasScheme ? value : `${/^localhost(?::|[/?#]|$)/i.test(value) ? 'http' : 'https'}://${value}`,
  )
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('Use an HTTP or HTTPS address.')
  return url.href
}
