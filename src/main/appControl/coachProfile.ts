import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { coachProfileSchema, coachProfilePatch } from '../../shared/editorCoach'

export function readCoachProfile(file: string) {
  const defaults = { level: '', teachingStyle: '', editorHelp: '' }
  let profile = defaults
  try {
    profile = {
      ...defaults,
      ...coachProfileSchema
        .partial()
        .parse(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw Error(
        'The learner profile could not be read. Check coach-profile.json in the Threadlight data folder.',
        { cause: error },
      )
  }
  const revision = createHash('sha256').update(JSON.stringify(profile)).digest('hex')
  return { profile, revision }
}

export function updateCoachProfile(file: string, expectedRevision: string, changes: unknown) {
  const { profile, revision } = readCoachProfile(file)
  if (expectedRevision !== revision) return false
  const patch = coachProfilePatch.parse(changes)
  const next = { ...profile, ...patch }
  mkdirSync(dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
  return true
}
