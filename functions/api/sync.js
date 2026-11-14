// Cloudflare Pages Functions - /api/sync
// Batch synchronize all tasks to Cloudflare D1

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
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

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

async function ensureTable(db) {
  try {
    const stmts = INIT_SQL.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of stmts) {
      await db.prepare(sql).run();
    }
  } catch (err) {
    console.error('Error ensuring table:', err);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

// POST: Batch sync tasks into Cloudflare D1
export async function onRequestPost({ request, env }) {
  const db = getDb(env);
  if (!db) {
    const available = Object.keys(env || {}).filter(k => k !== 'ASSETS');
    return new Response(JSON.stringify({
      success: false,
      error: `D1 database binding not found. (Detected: [${available.join(', ') || 'none'}])`
    }), { status: 500, headers: jsonHeaders });
  }

  try {
    const body = await request.json();
    let tasksToSync = [];
    let shouldReplace = false;

    if (Array.isArray(body)) {
      tasksToSync = body;
    } else if (body && Array.isArray(body.tasks)) {
      tasksToSync = body.tasks;
      shouldReplace = !!body.replace;
    }

    if (!Array.isArray(tasksToSync) || (!shouldReplace && tasksToSync.length === 0)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No tasks provided for sync'
      }), { status: 400, headers: jsonHeaders });
    }

    await ensureTable(db);

    const statements = [];

    if (shouldReplace) {
      statements.push(db.prepare('DELETE FROM tasks'));
    }

    const upsertSql = `
      INSERT INTO tasks (id, title, options, note, description, date, deadline, status, assignee_ids, priority, color, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        options = excluded.options,
        note = excluded.note,
        description = excluded.description,
        date = excluded.date,
        deadline = excluded.deadline,
        status = excluded.status,
        assignee_ids = excluded.assignee_ids,
        priority = excluded.priority,
        color = excluded.color,
        updated_at = datetime('now')
    `;

    for (const task of tasksToSync) {
      if (!task.id || !task.title) continue;
      const optionsJson = JSON.stringify(task.options || []);
      const assigneeIdsJson = JSON.stringify(task.assigneeIds || task.assignee_ids || ['non']);

      statements.push(
        db.prepare(upsertSql).bind(
          task.id,
          task.title,
          optionsJson,
          task.note || '',
          task.description || '',
          task.date || '',
          task.deadline || '',
          task.status || 'todo',
          assigneeIdsJson,
          task.priority || 'normal',
          task.color || 'blue'
        )
      );
    }

    if (statements.length > 0) {
      // Execute in batch (atomic transaction)
      await db.batch(statements);
    }
    await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully synchronized ${statements.length} tasks with Cloudflare D1`,
      syncedCount: statements.length
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), { status: 500, headers: jsonHeaders });
  }
}
