/* global document, createImageBitmap */
/** Inspect composited pixels: WebGL is allowed to discard its buffer after presentation. */
export async function readMotionFrame(locator) {
  const screenshot = await locator.screenshot()
  return locator.evaluate(
    async (_host, bytes) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
      )
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      image.close()
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0,
        hash = 0,
        left = canvas.width,
        right = 0
      for (let i = 0; i < pixels.length; i++) hash = ((hash << 5) - hash + pixels[i]) | 0
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
          const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2])
          if (max > 50 && max - min > 18) {
            count++
            left = Math.min(left, x)
            right = Math.max(right, x)
          }
        }
      }
      return { count, hash, span: (right - left) / canvas.width }
    },
    [...screenshot],
  )
}
