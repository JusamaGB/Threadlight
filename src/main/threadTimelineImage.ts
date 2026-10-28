import { isAbsolute } from 'node:path'
import type { TimelineImageReply } from '../shared/threadTimeline'
import { artifactContent, readArtifactBytes } from './artifacts'
import { localArtifactPath, referenceKind } from './artifactReferences'

/** Reuse the bounded raster-image reader; never fetch a URL or execute image markup. */
export async function readTimelineImage(recordedPath: string): Promise<TimelineImageReply> {
  const path = localArtifactPath(recordedPath, '')
  if (!path || !isAbsolute(recordedPath) || referenceKind(path) !== 'image')
    return { ok: false, reason: 'This image preview is not available.' }
  try {
    const preview = artifactContent(await readArtifactBytes(path), path)
    return { ok: true, dataUrl: preview.content }
  } catch {
    return {
      ok: false,
      reason: 'Image unavailable. It may have moved or exceed the 5 MiB preview limit.',
    }
  }
}
