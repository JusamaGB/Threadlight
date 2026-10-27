import { Worker } from 'node:worker_threads'

/** Provider-owned SQLite runs off Electron's event loop; deadlines terminate blocked readers. */
export function queryDatabase(
  path: string,
  queries: {
    sql: string
    params?: (string | number)[]
    columns?: string[]
    turnColumn?: boolean
  }[],
  timeout = 3000,
): Promise<Record<string, unknown>[][]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      let db;
      try {
        db = new DatabaseSync(workerData.path, {readOnly:true});
        db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN');
        const results = workerData.queries.map(q => {
          const rows=[]; let bytes=0, sql=q.sql;
          if(q.columns) {
            const fields=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
            if(!fields.has('id'))throw new Error('Unsupported metadata schema.');
            sql=sql.replace('$columns',q.columns.filter(c=>fields.has(c)).join(','));
          }
          if(q.turnColumn) {
            const fields=new Set(db.prepare('PRAGMA table_info(thread_items)').all().map(r=>r.name));
            sql=sql.replace('$turnId',fields.has('turn_id')?'turn_id':'NULL');
          }
          for (const row of db.prepare(sql).iterate(...(q.params || []))) {
            const size=Buffer.byteLength(JSON.stringify(row));
            if(bytes+size>2*1024*1024) { rows.push({_budgetExceeded:true,rollout_ordinal:row.rollout_ordinal,id:row.id}); break; }
            rows.push(row); bytes+=size;
          }
          return rows;
        });
        db.exec('ROLLBACK'); parentPort.postMessage({results});
      } catch (e) { parentPort.postMessage({error: e.message}); }
      finally { if(db) db.close(); }
    `,
      { eval: true, workerData: { path, queries }, env: { ...process.env, NODE_NO_WARNINGS: '1' } },
    )
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Source read deadline exceeded.'))
    }, timeout)
    worker.once('message', (message) => {
      clearTimeout(timer)
      if (message.error) reject(new Error(message.error))
      else resolve(message.results)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer)
        reject(new Error('Source reader exited.'))
      }
    })
  })
}
