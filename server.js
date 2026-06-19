const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { db, generateToken, hashPassword, verifyPassword } = require('./db');
const { computeScores, items, schemas, TOTAL_ITEMS } = require('./scoring');
const SQLiteStore = require('./session-store')(session);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- Rate limiter for login ----------
const loginAttempts = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, times] of loginAttempts) {
    const recent = times.filter(t => t > cutoff);
    if (recent.length) loginAttempts.set(ip, recent);
    else loginAttempts.delete(ip);
  }
}, 30000);

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  const recent = attempts.filter(t => now - t < 60000);
  if (recent.length >= 5) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde 1 minuto.' });
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  next();
}

app.use(session({
  store: SQLiteStore,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// ---------- Bootstrap: cria admin padrão se nao existir nenhum ----------
function ensureDefaultAdmin() {
  const row = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
  if (row.c === 0) {
    const defaultUser = process.env.ADMIN_USER || 'admin';
    const defaultPass = process.env.ADMIN_PASS || 'mudar123';
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)')
      .run(defaultUser, hashPassword(defaultPass));
    console.log(`>> Admin padrao criado: usuario="${defaultUser}" senha="${defaultPass}" (MUDE ISSO)`);
  }
}
ensureDefaultAdmin();

// ---------- Middleware de autenticacao admin ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'nao autenticado' });
  return res.redirect('/admin/login');
}

// ================= ROTAS PUBLICAS (PACIENTE) =================

// Pagina do formulario do paciente (token na URL)
app.get('/f/:token', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE token = ?').get(req.params.token);
  if (!patient) return res.status(404).sendFile(path.join(__dirname, 'public', 'not-found.html'));
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

// API: dados iniciais do formulario (itens + respostas ja salvas)
app.get('/api/form/:token', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE token = ?').get(req.params.token);
  if (!patient) return res.status(404).json({ error: 'link invalido' });

  const responses = db.prepare('SELECT item_number, score FROM responses WHERE patient_id = ?').all(patient.id);

  res.json({
    patientName: patient.name,
    completed: !!patient.completed_at,
    items,
    totalItems: TOTAL_ITEMS,
    responses
  });
});

// API: salvar uma resposta (autosave a cada clique)
app.post('/api/form/:token/answer', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE token = ?').get(req.params.token);
  if (!patient) return res.status(404).json({ error: 'link invalido' });
  if (patient.completed_at) return res.status(400).json({ error: 'questionario ja finalizado' });

  const { itemNumber, score } = req.body;
  const n = Number(itemNumber);
  const s = Number(score);

  if (!Number.isInteger(n) || n < 1 || n > TOTAL_ITEMS) {
    return res.status(400).json({ error: 'item invalido' });
  }
  if (!Number.isInteger(s) || s < 1 || s > 6) {
    return res.status(400).json({ error: 'pontuacao invalida' });
  }

  db.prepare(`
    INSERT INTO responses (patient_id, item_number, score, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(patient_id, item_number)
    DO UPDATE SET score = excluded.score, updated_at = datetime('now')
  `).run(patient.id, n, s);

  const count = db.prepare('SELECT COUNT(*) as c FROM responses WHERE patient_id = ?').get(patient.id).c;

  res.json({ ok: true, answeredCount: count, totalItems: TOTAL_ITEMS });
});

// API: finalizar questionario
app.post('/api/form/:token/finish', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE token = ?').get(req.params.token);
  if (!patient) return res.status(404).json({ error: 'link invalido' });

  const count = db.prepare('SELECT COUNT(*) as c FROM responses WHERE patient_id = ?').get(patient.id).c;
  if (count < TOTAL_ITEMS) {
    return res.status(400).json({ error: 'ainda ha itens nao respondidos', answeredCount: count, totalItems: TOTAL_ITEMS });
  }

  db.prepare("UPDATE patients SET completed_at = datetime('now') WHERE id = ?").run(patient.id);
  res.json({ ok: true });
});

// ================= ROTAS ADMIN =================

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/api/admin/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'usuario ou senha invalidos' });
  }
  req.session.adminId = user.id;
  loginAttempts.delete(req.ip || req.connection.remoteAddress);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/admin/paciente/:id', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-patient.html'));
});

// API admin: listar pacientes
app.get('/api/admin/patients', requireAdmin, (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY created_at DESC').all();
  const withProgress = patients.map(p => {
    const count = db.prepare('SELECT COUNT(*) as c FROM responses WHERE patient_id = ?').get(p.id).c;
    const lastResp = db.prepare('SELECT MAX(updated_at) as last FROM responses WHERE patient_id = ?').get(p.id);
    return {
      id: p.id,
      name: p.name,
      token: p.token,
      createdAt: p.created_at,
      completedAt: p.completed_at,
      lastAnsweredAt: lastResp?.last || null,
      answeredCount: count,
      totalItems: TOTAL_ITEMS,
      progressPct: Math.round((count / TOTAL_ITEMS) * 100)
    };
  });
  res.json(withProgress);
});

// API admin: criar paciente (gera link)
app.post('/api/admin/patients', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'nome obrigatorio' });

  const token = generateToken();
  const result = db.prepare('INSERT INTO patients (name, token) VALUES (?, ?)').run(name.trim(), token);
  res.json({ id: Number(result.lastInsertRowid), name: name.trim(), token });
});

// API admin: deletar paciente
app.delete('/api/admin/patients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM responses WHERE patient_id = ?').run(req.params.id);
  db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// API admin: alterar senha
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'senha atual e nova senha sao obrigatorias' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'nova senha deve ter no minimo 6 caracteres' });
  }
  if (newPassword.length > 128) {
    return res.status(400).json({ error: 'nova senha muito longa' });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(403).json({ error: 'senha atual incorreta' });
  }

  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), user.id);
  res.json({ ok: true, message: 'Senha alterada com sucesso' });
});

// API admin: resultado detalhado de um paciente
app.get('/api/admin/patients/:id/results', requireAdmin, (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'paciente nao encontrado' });

  const responses = db.prepare('SELECT item_number, score FROM responses WHERE patient_id = ?').all(patient.id);
  const scores = computeScores(responses);

  res.json({
    patient: {
      id: patient.id,
      name: patient.name,
      token: patient.token,
      createdAt: patient.created_at,
      completedAt: patient.completed_at
    },
    rawResponses: responses,
    items,
    ...scores
  });
});

app.listen(PORT, () => {
  console.log(`YSQ-L3 app rodando em http://localhost:${PORT}`);
});
