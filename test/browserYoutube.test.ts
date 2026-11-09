import { describe, expect, it } from 'vitest'
import { isYouTubePage } from '../src/main/browser/youtube'

describe('YouTube layout scope', () => {
  it.each([
    'https://www.youtube.com/watch?v=test',
    'https://youtube.com/results',
    'https://m.youtube.com/',
  ])('recognises %s', (url) => {
    expect(isYouTubePage(url)).toBe(true)
  })
  it.each([
    'https://youtube.com.example.org/',
    'https://example.org/?youtube.com',
    'file://youtube.com/watch',
    'https://www.youtube-nocookie.com/embed/test',
    'not a URL',
  ])('leaves %s alone', (url) => {
    expect(isYouTubePage(url)).toBe(false)
  })
})
