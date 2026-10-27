export interface MotionRenderer {
  kind: 'webgl' | 'canvas'
  draw(vertices: Float32Array, width: number, height: number, scale: number): void
  dispose(): void
}

/** Small untextured mesh: no dependencies, readbacks, offscreen bloom buffers or remote assets. */
export function createWebGLRenderer(canvas: HTMLCanvasElement): MotionRenderer | null {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const dispose = () => {
    shaders.forEach((shader) => gl.deleteShader(shader))
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  try {
    if (!program || !buffer) throw new Error('Graphics resources unavailable')
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Shader unavailable')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error('Shader compilation failed')
      gl.attachShader(program, shader)
    }
    compile(
      gl.VERTEX_SHADER,
      `
      attribute vec2 position;
      attribute vec4 colour;
      uniform vec2 resolution;
      varying vec4 light;
      void main() {
        vec2 p = position / resolution * 2.0 - 1.0;
        gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
        light = colour;
      }
    `,
    )
    compile(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      varying vec4 light;
      void main() { gl_FragColor = vec4(light.rgb * light.a, light.a); }
    `,
    )
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed')
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const position = gl.getAttribLocation(program, 'position')
    const colour = gl.getAttribLocation(program, 'colour')
    const resolution = gl.getUniformLocation(program, 'resolution')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 24, 0)
    gl.enableVertexAttribArray(colour)
    gl.vertexAttribPointer(colour, 4, gl.FLOAT, false, 24, 8)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    return {
      kind: 'webgl',
      draw(vertices, width, height) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform2f(resolution, width, height)
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6)
      },
      dispose,
    }
  } catch {
    dispose()
    return null
  }
}

/** The same shapes remain available on machines that disable WebGL or lose their GPU context. */
export function createCanvasRenderer(canvas: HTMLCanvasElement): MotionRenderer | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  return {
    kind: 'canvas',
    draw(vertices, width, height, scale) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, width, height)
      for (let i = 0; i < vertices.length; i += 18) {
        const r = Math.round(vertices[i + 2]! * 255)
        const g = Math.round(vertices[i + 3]! * 255)
        const b = Math.round(vertices[i + 4]! * 255)
        ctx.fillStyle = `rgba(${r},${g},${b},${vertices[i + 5]!})`
        ctx.beginPath()
        ctx.moveTo(vertices[i]!, vertices[i + 1]!)
        ctx.lineTo(vertices[i + 6]!, vertices[i + 7]!)
        ctx.lineTo(vertices[i + 12]!, vertices[i + 13]!)
        ctx.fill()
      }
    },
    dispose() {},
  }
}
