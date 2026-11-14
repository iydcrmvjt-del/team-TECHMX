// Cloudflare Pages Advanced Mode Worker (_worker.js)
// Works with both Dashboard Drag & Drop (Direct Upload) and Git Deployments

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
`;

async function ensureTable(db) {
  if (!db) return;
  try {
    const stmts = INIT_SQL.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of stmts) {
      await db.prepare(sql).run();
    }
  } catch (err) {
    console.error('Error ensuring table:', err);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: jsonHeaders });
    }

    // 1. API: /api/tasks
    if (url.pathname === '/api/tasks') {
      if (!env.DB) {
        return new Response(JSON.stringify({
          success: false,
          error: 'D1 database binding "DB" not found. Please bind your D1 database to variable name "DB" in Cloudflare Pages Settings.',
          fallback: true,
          tasks: []
        }), { status: 200, headers: jsonHeaders });
      }

      if (request.method === 'GET') {
        try {
          let queryResult;
          try {
            queryResult = await env.DB.prepare('SELECT * FROM tasks ORDER BY deadline ASC, created_at ASC').all();
          } catch (dbErr) {
            if (dbErr.message && dbErr.message.includes('no such table')) {
              await ensureTable(env.DB);
              queryResult = await env.DB.prepare('SELECT * FROM tasks ORDER BY deadline ASC, created_at ASC').all();
            } else {
              throw dbErr;
            }
          }

          const tasks = (queryResult.results || []).map(row => {
            let options = [];
            try { options = typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || []); } catch(e) { options = []; }
            let assigneeIds = [];
            try { assigneeIds = typeof row.assignee_ids === 'string' ? JSON.parse(row.assignee_ids) : (row.assignee_ids || []); } catch(e) { assigneeIds = ['non']; }

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

          return new Response(JSON.stringify({ success: true, count: tasks.length, tasks }), { headers: jsonHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message, tasks: [] }), { status: 500, headers: jsonHeaders });
        }
      }

      if (request.method === 'POST') {
        try {
          const task = await request.json();
          if (!task || !task.id || !task.title) {
            return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), { status: 400, headers: jsonHeaders });
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
            await env.DB.prepare(sql).bind(
              task.id, task.title, optionsJson, task.note || '', task.description || '',
              task.date || '', task.deadline || '', task.status || 'todo',
              assigneeIdsJson, task.priority || 'normal', task.color || 'blue'
            ).run();
          } catch (insertErr) {
            if (insertErr.message && insertErr.message.includes('no such table')) {
              await ensureTable(env.DB);
              await env.DB.prepare(sql).bind(
                task.id, task.title, optionsJson, task.note || '', task.description || '',
                task.date || '', task.deadline || '', task.status || 'todo',
                assigneeIdsJson, task.priority || 'normal', task.color || 'blue'
              ).run();
            } else {
              throw insertErr;
            }
          }

          return new Response(JSON.stringify({ success: true, message: 'Task saved successfully', taskId: task.id }), { headers: jsonHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
        }
      }

      if (request.method === 'DELETE') {
        try {
          let taskId = url.searchParams.get('id');
          if (!taskId) {
            try { const b = await request.json(); taskId = b.id; } catch(e) {}
          }
          if (!taskId) {
            return new Response(JSON.stringify({ success: false, error: 'Missing task id' }), { status: 400, headers: jsonHeaders });
          }
          await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
          return new Response(JSON.stringify({ success: true, message: 'Task deleted successfully', taskId }), { headers: jsonHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
        }
      }
    }

    // 2. API: /api/sync
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      if (!env.DB) {
        return new Response(JSON.stringify({ success: false, error: 'D1 database not bound' }), { status: 500, headers: jsonHeaders });
      }
      try {
        const body = await request.json();
        let tasksToSync = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : []);
        let shouldReplace = body && body.replace;

        await ensureTable(env.DB);
        const statements = [];
        if (shouldReplace) statements.push(env.DB.prepare('DELETE FROM tasks'));

        const upsertSql = `
          INSERT INTO tasks (id, title, options, note, description, date, deadline, status, assignee_ids, priority, color, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, options = excluded.options, note = excluded.note,
            description = excluded.description, date = excluded.date, deadline = excluded.deadline,
            status = excluded.status, assignee_ids = excluded.assignee_ids, priority = excluded.priority,
            color = excluded.color, updated_at = datetime('now')
        `;

        for (const task of tasksToSync) {
          if (!task.id || !task.title) continue;
          statements.push(env.DB.prepare(upsertSql).bind(
            task.id, task.title, JSON.stringify(task.options || []), task.note || '', task.description || '',
            task.date || '', task.deadline || '', task.status || 'todo',
            JSON.stringify(task.assigneeIds || task.assignee_ids || ['non']), task.priority || 'normal', task.color || 'blue'
          ));
        }

        if (statements.length > 0) {
          await env.DB.batch(statements);
        }
        return new Response(JSON.stringify({ success: true, message: `Synced ${statements.length} tasks`, count: statements.length }), { headers: jsonHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // 3. API: /api/init
    if (url.pathname === '/api/init') {
      if (!env.DB) {
        return new Response(JSON.stringify({ success: false, status: 'unbound', message: 'DB not bound' }), { headers: jsonHeaders });
      }
      try {
        await ensureTable(env.DB);
        const countRes = await env.DB.prepare('SELECT COUNT(*) AS total FROM tasks').first();
        return new Response(JSON.stringify({ success: true, status: 'ready', count: countRes ? countRes.total : 0 }), { headers: jsonHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // 4. Default: Serve static assets (index.html, etc.) via Pages asset handler
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
