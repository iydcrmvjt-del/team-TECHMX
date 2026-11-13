-- ==========================================================
-- Cloudflare D1 Database Schema for Team TaskFlow
-- ==========================================================

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',       -- JSON Array: ["Roll A", "ตัดต่อ", ...]
  note TEXT DEFAULT '',                     -- Delivery links & notes
  description TEXT DEFAULT '',              -- Full text description
  date TEXT NOT NULL,                       -- Start date (YYYY-MM-DD)
  deadline TEXT NOT NULL,                   -- Deadline date (YYYY-MM-DD)
  status TEXT NOT NULL DEFAULT 'todo',      -- 'todo', 'in-progress', 'done'
  assignee_ids TEXT NOT NULL DEFAULT '["non"]', -- JSON Array: ["non", "aun", ...]
  priority TEXT NOT NULL DEFAULT 'normal',  -- 'high', 'normal', 'low'
  color TEXT NOT NULL DEFAULT 'blue',       -- One of the 15 colors
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
