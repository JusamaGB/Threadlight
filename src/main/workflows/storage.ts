import type { DatabaseSync } from 'node:sqlite'
export function initializeProcessStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS process_definitions(id TEXT,revision INTEGER,space TEXT,data TEXT,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS process_runs(id TEXT PRIMARY KEY,space TEXT,data TEXT);
    CREATE TABLE IF NOT EXISTS process_grants(id TEXT PRIMARY KEY,data TEXT);
    CREATE TABLE IF NOT EXISTS process_triggers(id TEXT PRIMARY KEY,slot TEXT);
    CREATE TABLE IF NOT EXISTS process_trigger_slots(id TEXT,slot TEXT,PRIMARY KEY(id,slot));`)
}
