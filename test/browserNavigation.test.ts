import { describe, expect, it } from 'vitest'
import { browserUrl } from '../src/shared/browserNavigation'

describe('browser address and search input', () => {
  it.each([
    ['google', 'https://www.google.com/search?q=google'],
    ['CS50 week four lecture', 'https://www.google.com/search?q=CS50%20week%20four%20lecture'],
    ['  café & tea?  ', 'https://www.google.com/search?q=caf%C3%A9%20%26%20tea%3F'],
    ['youtube.com', 'https://youtube.com/'],
    ['example.com:8080/path', 'https://example.com:8080/path'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost/test', 'http://localhost/test'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/'],
    ['https://example.com/a?q=b#c', 'https://example.com/a?q=b#c'],
    ['https://intranet', 'https://intranet/'],
    ['[::1]:8080', 'https://[::1]:8080/'],
  ])('resolves %s', (input, expected) => expect(browserUrl(input)).toBe(expected))
  it.each([
    '',
    'javascript:alert(1)',
    'file:///C:/secret',
    'data:text/html,test',
    'https://user:password@example.com',
  ])('rejects unsupported input %s', (input) => {
    expect(() => browserUrl(input)).toThrow()
  })
})
