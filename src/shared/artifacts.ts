export interface ThreadArtifact {
  id: string
  title: string
  kind: 'image' | 'text' | 'html' | 'unsupported'
  mime: string
  createdAt: number
  source?: 'reference' | 'copy'
  path?: string
}

export type ArtifactReply =
  | { ok: true; items: ThreadArtifact[]; content?: string; notice?: string }
  | { ok: false; reason: string }

export type ArtifactPreviewRequest =
  | { action: 'open'; token: string; threadId: string; id: string }
  | { action: 'close'; token: string }
  | {
      action: 'bounds'
      token: string
      bounds: { x: number; y: number; width: number; height: number }
    }

export type ArtifactPreviewEvent = {
  token: string
  type: 'escape' | 'failed' | 'previous' | 'next'
  reason?: string
}

/** Static HTML only: scripts, forms, network and nested frames are disabled. */
export function artifactDocument(html: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"></head><body>${html}</body></html>`
}
