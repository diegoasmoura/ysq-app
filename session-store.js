const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

function SQLiteStore(session) {
  const Store = session.Store;
  class SQLiteStore extends Store {
    get(sid, cb) {
      try {
        const row = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?').get(sid, Date.now());
        cb(null, row ? JSON.parse(row.data) : null);
      } catch (e) {
        cb(e);
      }
    }
    set(sid, sessionData, cb) {
      try {
        const expiresAt = sessionData.cookie && sessionData.cookie.maxAge
          ? Date.now() + sessionData.cookie.maxAge
          : Date.now() + 86400000;
        db.prepare(`
          INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
        `).run(sid, JSON.stringify(sessionData), expiresAt);
        cb(null);
      } catch (e) {
        cb(e);
      }
    }
    destroy(sid, cb) {
      try {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        cb(null);
      } catch (e) {
        cb(e);
      }
    }
    touch(sid, sessionData, cb) {
      try {
        const expiresAt = sessionData.cookie && sessionData.cookie.maxAge
          ? Date.now() + sessionData.cookie.maxAge
          : Date.now() + 86400000;
        db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
        cb(null);
      } catch (e) {
        cb(e);
      }
    }
  }
  return new SQLiteStore();
}

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 3600000);

module.exports = SQLiteStore;
