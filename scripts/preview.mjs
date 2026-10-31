import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 4173);
mkdirSync(join(root, '.sites-runtime'), { recursive: true });
const sqlite = new DatabaseSync(join(root, '.sites-runtime', 'preview.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _preview_migrations (name TEXT PRIMARY KEY);');
for (const file of readdirSync(join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM _preview_migrations WHERE name = ?').get(file)) continue;
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(readFileSync(join(root, 'drizzle', file), 'utf8'));
    sqlite.prepare('INSERT INTO _preview_migrations(name) VALUES (?)').run(file);
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
}
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first(column) { const row = sqlite.prepare(this.sql).get(...this.values); return column ? (row?.[column] ?? null) : (row ? { ...row } : null); }
  async all() { return { success: true, results: sqlite.prepare(this.sql).all(...this.values).map((row) => ({ ...row })), meta: {} }; }
  async run() { const result = sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
}
const DB = {
  prepare(sql) { return new Statement(sql); },
  async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
};
const { default: worker } = await import(pathToFileURL(join(root, 'dist/server/index.js')));
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const init = { method: incoming.method, headers: incoming.headers };
    if (!['GET', 'HEAD'].includes(incoming.method)) { init.body = Buffer.concat(chunks); init.duplex = 'half'; }
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, init);
    const response = await worker.fetch(request, { DB }, { waitUntil() {} });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { outgoing.writeHead(500, { 'content-type': 'text/plain' }); outgoing.end(error.stack); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
function stop() { server.close(() => { sqlite.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
