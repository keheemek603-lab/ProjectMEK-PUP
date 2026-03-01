// server.js (RENDER + VERCEL FIX)
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_me_super_secret";

// ---------- CORS (ให้ Vercel เรียก Render ได้) ----------
const ALLOW_ORIGINS = new Set([
  "https://project-mek-pup.vercel.app", // <-- โดเมน Vercel ของมึง
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOW_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- BODY PARSER ----------
app.use(
  express.json({
    limit: "2mb",
    type: ["application/json", "application/*+json", "text/json", "*/*"],
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString?.("utf8") || "";
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ---------- DB (ใช้ DATABASE_URL ของ Render) ----------
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render Postgres ใช้ SSL (ปลอดภัยสุดเปิดไว้เลย)
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "postgres",
    });

// ---------- STATIC ----------
app.use(express.static(__dirname));
app.use("/assets", express.static(path.join(__dirname, "assets")));

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- HEALTH ----------
app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, dbTime: r.rows[0].now });
  } catch (e) {
    console.error("HEALTH DB ERROR:", e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- AUTH ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username & password required" });
    if (String(username).length < 3) return res.status(400).json({ error: "username must be >= 3 chars" });
    if (String(password).length < 6) return res.status(400).json({ error: "password must be >= 6 chars" });

    const exists = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
    if (exists.rowCount) return res.status(409).json({ error: "Username already exists" });

    const password_hash = await bcrypt.hash(password, 10);
    const created = await pool.query(
      "INSERT INTO users(username, password_hash) VALUES($1,$2) RETURNING id, username",
      [username, password_hash]
    );

    const user = created.rows[0];
    res.json({ token: signToken(user), user });
  } catch (e) {
    console.error("REGISTER ERROR:", e?.message || e);
    res.status(500).json({ error: "Register failed", detail: String(e?.message || e) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username & password required" });

    const r = await pool.query("SELECT id, username, password_hash FROM users WHERE username=$1", [username]);
    if (!r.rowCount) return res.status(401).json({ error: "Invalid credentials" });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error("LOGIN ERROR:", e?.message || e);
    res.status(500).json({ error: "Login failed", detail: String(e?.message || e) });
  }
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: { id: req.user.uid, username: req.user.username } });
});

// ---------- QUIZ ----------
app.get("/api/quiz/questions", auth, async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.n || 10), 1), 50);
    const r = await pool.query(
      `SELECT id, question, choice_a, choice_b, choice_c, choice_d
       FROM questions
       ORDER BY RANDOM()
       LIMIT $1`,
      [n]
    );

    const questions = r.rows.map((q) => ({
      id: q.id,
      question: q.question,
      choices: [q.choice_a, q.choice_b, q.choice_c, q.choice_d],
    }));

    res.json({ questions });
  } catch (e) {
    console.error("QUESTIONS ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load questions" });
  }
});

app.post("/api/quiz/submit", auth, async (req, res) => {
  try {
    let body = req.body;

    if ((typeof body === "string" || !body || Object.keys(body).length === 0) && req.rawBody) {
      try {
        body = JSON.parse(req.rawBody);
      } catch {}
    }

    const answers = Array.isArray(body?.answers) ? body.answers : [];
    if (!answers.length) return res.status(400).json({ error: "answers required" });
    if (answers.length > 50) return res.status(400).json({ error: "too many answers" });

    const ids = [...new Set(answers.map((a) => Number(a.id)).filter(Number.isFinite))];
    if (!ids.length) return res.status(400).json({ error: "invalid question ids" });

    const r = await pool.query("SELECT id, correct_index FROM questions WHERE id = ANY($1::int[])", [ids]);
    const correct = new Map(r.rows.map((x) => [x.id, x.correct_index]));

    let score = 0;
    let total = 0;

    for (const a of answers) {
      const qid = Number(a.id);
      const choiceIndex = Number(a.choiceIndex);
      if (!correct.has(qid)) continue;
      if (!Number.isFinite(choiceIndex)) continue;
      total++;
      if (choiceIndex === correct.get(qid)) score++;
    }

    const saved = await pool.query(
      "INSERT INTO scores(user_id, score, total) VALUES($1,$2,$3) RETURNING id, score, total, created_at",
      [req.user.uid, score, total]
    );

    res.json({
      result: {
        score,
        total,
        percent: total ? Math.round((score / total) * 100) : 0,
        saved: saved.rows[0],
      },
    });
  } catch (e) {
    console.error("SUBMIT ERROR:", e?.message || e);
    res.status(500).json({ error: "Submit failed" });
  }
});

// ---------- SCOREBOARD ----------
app.get("/api/scoreboard", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const r = await pool.query(
      `SELECT s.id, u.username, s.score, s.total, s.created_at
       FROM scores s
       JOIN users u ON u.id = s.user_id
       ORDER BY
         (CASE WHEN s.total=0 THEN 0 ELSE (s.score::float / s.total) END) DESC,
         s.score DESC,
         s.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ rows: r.rows });
  } catch (e) {
    console.error("SCOREBOARD ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load scoreboard" });
  }
});

// fallback หน้าเว็บเดิม
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));