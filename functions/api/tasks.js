// Cloudflare Pages Functions - /api/tasks
// Handles GET, POST, DELETE with Cloudflare D1 Database

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// GET: Fetch all tasks from Cloudflare D1
export async function onRequestGet({ env }) {
  const db = getDb(env);
  if (!db) {
    const available = Object.keys(env || {}).filter(k => k !== 'ASSETS');
    return new Response(JSON.stringify({
      success: false,
      error: `ยังไม่พบการผูก D1 Database (ตัวแปรในระบบ: [${available.join(', ') || 'ไม่มี'}]). ให้ผูก D1 ในหน้า Settings ➔ Bindings แล้วกด Retry deployment ครับ`,
      fallback: true,
      tasks: []
    }), { status: 200, headers: jsonHeaders });
  }

  try {
    await ensureTable(db);
    let queryResult = await db.prepare('SELECT * FROM tasks ORDER BY deadline ASC, created_at ASC').all();

    let isSeeded = false;
    try {
      const metaRow = await db.prepare("SELECT value FROM meta WHERE key = 'seeded'").first();
      if (metaRow) isSeeded = true;
    } catch(e) {}

    const tasks = (queryResult.results || []).map(row => {
      let options = [];
      try {
        options = typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || []);
      } catch (e) {
        options = [];
      }

      let assigneeIds = [];
      try {
        assigneeIds = typeof row.assignee_ids === 'string' ? JSON.parse(row.assignee_ids) : (row.assignee_ids || []);
      } catch (e) {
        assigneeIds = ['non'];
      }

      return {
        id: row.id,
        title: row.title || '',
        options: Array.isArray(options) ? options : [],
        note: row.note || '',
        description: row.description || '',
        date: row.date || '',
        deadline: row.deadline || '',
        status: row.status || 'todo',
        assigneeIds: Array.isArray(assigneeIds) ? assigneeIds : ['non'],
        priority: row.priority || 'normal',
        color: row.color || 'blue',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    return new Response(JSON.stringify({
      success: true,
      count: tasks.length,
      tasks,
      seeded: isSeeded
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      tasks: []
    }), { status: 500, headers: jsonHeaders });
  }
}

// POST: Upsert (insert or update) a single task
export async function onRequestPost({ request, env }) {
  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({
      success: false,
      error: 'D1 database binding not found.'
    }), { status: 500, headers: jsonHeaders });
  }

  try {
    const task = await request.json();
    if (!task || !task.id || !task.title) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required task fields (id, title)'
      }), { status: 400, headers: jsonHeaders });
    }

    const optionsJson = JSON.stringify(task.options || []);
    const assigneeIdsJson = JSON.stringify(task.assigneeIds || task.assignee_ids || ['non']);

    const sql = `
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

    try {
      await db.prepare(sql).bind(
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
      ).run();
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('no such table')) {
        await ensureTable(db);
        await db.prepare(sql).bind(
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
        ).run();
      } else {
        throw insertErr;
      }
    }

    await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: 'Task saved successfully',
      taskId: task.id
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), { status: 500, headers: jsonHeaders });
  }
}

// DELETE: Delete a task by ID
export async function onRequestDelete({ request, env }) {
  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({
      success: false,
      error: 'D1 database binding not found.'
    }), { status: 500, headers: jsonHeaders });
  }

  try {
    const url = new URL(request.url);
    let taskId = url.searchParams.get('id');

    if (!taskId) {
      try {
        const body = await request.json();
        taskId = body.id;
      } catch (e) {}
    }

    if (!taskId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing task id'
      }), { status: 400, headers: jsonHeaders });
    }

    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
    await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: 'Task deleted successfully',
      taskId
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), { status: 500, headers: jsonHeaders });
  }
}
