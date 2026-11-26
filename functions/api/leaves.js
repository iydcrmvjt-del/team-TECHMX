// Cloudflare Pages Functions - /api/leaves
// Handles GET and POST for Team Leaves data in Cloudflare D1 meta table

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const INIT_SQL = `
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
    await db.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  } catch(e) {}
}

export async function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;
  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database not bound' }), { status: 503, headers: jsonHeaders });
  }

  try {
    await ensureTable(db);
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'leaves_data'").first();
    let leaves = [];
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) {
          leaves = parsed.filter(l => l && (!l.id || !String(l.id).startsWith("leave-sample-")));
        }
      } catch(e) {}
    }
    return new Response(JSON.stringify({ success: true, leaves }), { headers: jsonHeaders });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database not bound' }), { status: 503, headers: jsonHeaders });
  }

  try {
    let body = await request.json();
    let leavesArray = Array.isArray(body) ? body : (body && body.leaves ? body.leaves : []);
    leavesArray = leavesArray.filter(l => l && (!l.id || !String(l.id).startsWith("leave-sample-")));
    await ensureTable(db);
    const val = JSON.stringify(leavesArray);
    await db.prepare("INSERT INTO meta (key, value) VALUES ('leaves_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(val).run();
    return new Response(JSON.stringify({ success: true, message: 'Leaves saved successfully' }), { headers: jsonHeaders });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders });
  }
}
