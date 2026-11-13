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

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({
      success: false,
      status: 'unbound',
      message: 'D1 binding "DB" is not connected yet. Please bind your D1 database to variable name "DB" in Cloudflare Pages dashboard.'
    }), { status: 200, headers: jsonHeaders });
  }

  try {
    const stmts = INIT_SQL.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of stmts) {
      await env.DB.prepare(sql).run();
    }

    const countRes = await env.DB.prepare('SELECT COUNT(*) AS total FROM tasks').first();

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
