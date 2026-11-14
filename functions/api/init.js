// Cloudflare Pages Functions - /api/init
// Diagnostic and table initialization endpoint

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  note TEXT DEFAULT '',
  description TEXT DEFAULT '',
  date TEXT NOT NULL,
  deadline TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee_ids TEXT NOT NULL DEFAULT '["non"]',
  priority TEXT NOT NULL DEFAULT 'normal',
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
`;

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

function getDb(env) {
  if (!env) return null;
  if (db && typeof db.prepare === 'function') return db;
  if (env.db && typeof env.db.prepare === 'function') return env.db;
  if (env['team-taskflow-db'] && typeof env['team-taskflow-db'].prepare === 'function') return env['team-taskflow-db'];
  if (env.team_taskflow_db && typeof env.team_taskflow_db.prepare === 'function') return env.team_taskflow_db;
  if (env.DATABASE && typeof env.DATABASE.prepare === 'function') return env.DATABASE;
  if (env.D1 && typeof env.D1.prepare === 'function') return env.D1;
  for (const key of Object.keys(env)) {
    if (env[key] && typeof env[key].prepare === 'function') {
      return env[key];
    }
  }
  return null;
}

export async function onRequestGet({ env }) {
  const db = getDb(env);
  if (!db) {
    const available = Object.keys(env || {}).filter(k => k !== 'ASSETS');
    return new Response(JSON.stringify({
      success: false,
      status: 'unbound',
      message: `D1 binding not found (Bindings: [${available.join(', ') || 'none'}])`
    }), { status: 200, headers: jsonHeaders });
  }

  try {
    const stmts = INIT_SQL.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of stmts) {
      await db.prepare(sql).run();
    }

    const countRes = await db.prepare('SELECT COUNT(*) AS total FROM tasks').first();

    return new Response(JSON.stringify({
      success: true,
      status: 'ready',
      message: 'Cloudflare D1 database is connected and initialized.',
      taskCount: countRes ? countRes.total : 0
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      status: 'error',
      error: err.message
    }), { status: 500, headers: jsonHeaders });
  }
}
