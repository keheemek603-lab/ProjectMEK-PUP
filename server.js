// server.js (FINAL FIX)
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_me_super_secret";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "postgres",
});

// ✅ BODY PARSER (กันทุกเคส + เก็บ rawBody)
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

// เสิร์ฟไฟล์หน้าเว็บจาก root
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

app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, dbTime: r.rows[0].now });
  } catch {
    res.status(500).json({ ok: false, error: "DB connection failed" });
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
  } catch {
    res.status(500).json({ error: "Register failed" });
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
  } catch {
    res.status(500).json({ error: "Login failed" });
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
  } catch {
    res.status(500).json({ error: "Failed to load questions" });
  }
});

// ✅ SUBMIT (กัน body หาย: fallback parse จาก rawBody)
app.post("/api/quiz/submit", auth, async (req, res) => {
  try {
    let body = req.body;

    // ถ้า req.body เป็น string หรือ {} แต่ rawBody มี ให้พยายาม parse เอง
    if ((typeof body === "string" || !body || Object.keys(body).length === 0) && req.rawBody) {
      try {
        body = JSON.parse(req.rawBody);
      } catch {
        // ignore
      }
    }

    const answers = Array.isArray(body?.answers) ? body.answers : [];

    // LOG ชัด ๆ (ช่วยจับได้ทันทีถ้ายังพัง)
    console.log("SUBMIT content-type:", req.headers["content-type"]);
    console.log("SUBMIT answers length:", answers.length);

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
    console.error("SUBMIT ERROR:", e);
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
  } catch {
    res.status(500).json({ error: "Failed to load scoreboard" });
  }
});

// fallback หน้าเว็บเดิม
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));