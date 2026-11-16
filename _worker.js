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
  is_all_day INTEGER DEFAULT 1,
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
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
  if (env.DB && typeof env.DB.prepare === 'function') return env.DB;
  if (env.db && typeof env.db.prepare === 'function') return env.db;
  if (env['team-taskflow-db'] && typeof env['team-taskflow-db'].prepare === 'function') return env['team-taskflow-db'];
  if (env.team_taskflow_db && typeof env.team_taskflow_db.prepare === 'function') return env.team_taskflow_db;
  if (env.DATABASE && typeof env.DATABASE.prepare === 'function') return env.DATABASE;
  if (env.D1 && typeof env.D1.prepare === 'function') return env.D1;
  for (const key of Object.keys(env)) {
    try {
      if (env[key] && typeof env[key].prepare === 'function') {
        return env[key];
      }
    } catch (e) {}
  }
  return null;
}

async function ensureTable(db) {
  if (!db) return;
  try {
    const stmts = INIT_SQL.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of stmts) {
      await db.prepare(sql).run();
    }
    try { await db.prepare("ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE tasks ADD COLUMN archived_at TEXT").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE tasks ADD COLUMN is_all_day INTEGER DEFAULT 1").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE tasks ADD COLUMN start_time TEXT DEFAULT ''").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE tasks ADD COLUMN end_time TEXT DEFAULT ''").run(); } catch(e) {}
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

      if (request.method === 'GET') {
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
              isAllDay: row.is_all_day === undefined || row.is_all_day === null ? true : Boolean(row.is_all_day),
              startTime: row.start_time || '',
              endTime: row.end_time || '',
              status: row.status || 'todo',
              assigneeIds: Array.isArray(assigneeIds) ? assigneeIds : ['non'],
              priority: row.priority || 'normal',
              color: row.color || 'blue',
              createdAt: row.created_at,
              updatedAt: row.updated_at
            };
          });

          return new Response(JSON.stringify({ success: true, count: tasks.length, tasks, seeded: isSeeded }), { headers: jsonHeaders });
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
            INSERT INTO tasks (id, title, options, note, description, date, deadline, is_all_day, start_time, end_time, status, assignee_ids, priority, color, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              options = excluded.options,
              note = excluded.note,
              description = excluded.description,
              date = excluded.date,
              deadline = excluded.deadline,
              is_all_day = excluded.is_all_day,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              status = excluded.status,
              assignee_ids = excluded.assignee_ids,
              priority = excluded.priority,
              color = excluded.color,
              updated_at = datetime('now')
          `;

          try {
            await db.prepare(sql).bind(
              task.id, task.title, optionsJson, task.note || '', task.description || '',
              task.date || '', task.deadline || '',
              task.isAllDay !== false ? 1 : 0,
              task.startTime || '', task.endTime || '',
              task.status || 'todo',
              assigneeIdsJson, task.priority || 'normal', task.color || 'blue'
            ).run();
          } catch (insertErr) {
            if (insertErr.message && insertErr.message.includes('no such table')) {
              await ensureTable(db);
              await db.prepare(sql).bind(
                task.id, task.title, optionsJson, task.note || '', task.description || '',
                task.date || '', task.deadline || '', task.status || 'todo',
                assigneeIdsJson, task.priority || 'normal', task.color || 'blue'
              ).run();
            } else {
              throw insertErr;
            }
          }

          await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});
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
          await db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
          await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});
          return new Response(JSON.stringify({ success: true, message: 'Task deleted successfully', taskId }), { headers: jsonHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
        }
      }
    }

    // 2. API: /api/sync
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const db = getDb(env);
      if (!db) {
        return new Response(JSON.stringify({ success: false, error: 'D1 database not bound' }), { status: 500, headers: jsonHeaders });
      }
      try {
        const body = await request.json();
        let tasksToSync = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : []);
        let shouldReplace = body && body.replace;

        await ensureTable(db);
        const statements = [];
        if (shouldReplace) statements.push(db.prepare('DELETE FROM tasks'));

        const upsertSql = `
          INSERT INTO tasks (id, title, options, note, description, date, deadline, is_all_day, start_time, end_time, status, assignee_ids, priority, color, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, options = excluded.options, note = excluded.note,
            description = excluded.description, date = excluded.date, deadline = excluded.deadline,
            is_all_day = excluded.is_all_day, start_time = excluded.start_time, end_time = excluded.end_time,
            status = excluded.status, assignee_ids = excluded.assignee_ids, priority = excluded.priority,
            color = excluded.color, updated_at = datetime('now')
        `;

        for (const task of tasksToSync) {
          if (!task.id || !task.title) continue;
          statements.push(db.prepare(upsertSql).bind(
            task.id, task.title, JSON.stringify(task.options || []), task.note || '', task.description || '',
            task.date || '', task.deadline || '',
            task.isAllDay !== false ? 1 : 0,
            task.startTime || '', task.endTime || '',
            task.status || 'todo',
            JSON.stringify(task.assigneeIds || task.assignee_ids || ['non']), task.priority || 'normal', task.color || 'blue'
          ));
        }

        if (statements.length > 0) {
          await db.batch(statements);
        }
        await db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run().catch(() => {});
        return new Response(JSON.stringify({ success: true, message: `Synced ${statements.length} tasks`, count: statements.length }), { headers: jsonHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // 3. API: /api/init
    if (url.pathname === '/api/init') {
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
        await ensureTable(db);
        const countRes = await db.prepare('SELECT COUNT(*) AS total FROM tasks').first();
        return new Response(JSON.stringify({ success: true, status: 'ready', count: countRes ? countRes.total : 0 }), { headers: jsonHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // 4. API: /api/lark (Proxy for Lark Custom Bot Webhook to avoid browser CORS)
    if (url.pathname === '/api/lark' && request.method === 'POST') {
      try {
        const body = await request.json();
        const webhookUrl = (body && body.webhookUrl) || (env && env.LARK_WEBHOOK_URL) || '';
        if (!webhookUrl) {
          return new Response(JSON.stringify({
            success: false,
            error: 'กรุณาระบุ Lark Webhook URL ในการตั้งค่า (Settings)'
          }), { status: 400, headers: jsonHeaders });
        }

        let parsed;
        try {
          parsed = new URL(webhookUrl);
        } catch(e) {
          return new Response(JSON.stringify({
            success: false,
            error: 'รูปแบบ Webhook URL ไม่ถูกต้อง'
          }), { status: 400, headers: jsonHeaders });
        }

        const allowedHosts = ['open.larksuite.com', 'open.feishu.cn'];
        if (!allowedHosts.includes(parsed.hostname) || !parsed.pathname.startsWith('/open-apis/bot/v2/hook/')) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Webhook URL ต้องมาจาก open.larksuite.com หรือ open.feishu.cn'
          }), { status: 400, headers: jsonHeaders });
        }

        const payload = (body && body.payload) ? body.payload : body;
        if (payload.webhookUrl) delete payload.webhookUrl;

        const larkRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify(payload)
        });

        const larkData = await larkRes.json().catch(() => ({}));
        if (!larkRes.ok || (larkData && larkData.code && larkData.code !== 0)) {
          return new Response(JSON.stringify({
            success: false,
            error: (larkData && (larkData.msg || larkData.message)) || `Lark Error HTTP ${larkRes.status}`,
            details: larkData
          }), { status: 200, headers: jsonHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'ส่งการแจ้งเตือนเข้า Lark สำเร็จ',
          details: larkData
        }), { headers: jsonHeaders });
      } catch(err) {
        return new Response(JSON.stringify({
          success: false,
          error: err.message
        }), { status: 500, headers: jsonHeaders });
      }
    }

    // 5. Default: Serve static assets (index.html, etc.) via Pages asset handler
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
