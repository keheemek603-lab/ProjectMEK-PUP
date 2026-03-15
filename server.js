const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_me_super_secret";
const VERSION = "community-stable-2026-03-16";

function parseOriginList(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

const ALLOWED_ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS);
[
  "https://hosting.bncc.ac.th",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
].forEach((origin) => ALLOWED_ORIGINS.add(origin));

function isAllowedOrigin(origin) {
  if (!origin) return false;

  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return true;
    if (url.hostname === "hosting.bncc.ac.th") return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

function buildPool() {
  if (process.env.DATABASE_URL) {
    const useSsl = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
  }

  return new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "postgres",
    ssl: String(process.env.DB_SSL || "false").toLowerCase() === "true" ? { rejectUnauthorized: false } : false,
  });
}

const pool = buildPool();

app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"), {
    fallthrough: true,
    maxAge: "7d",
  })
);

function safeSendFile(res, fileName, fallbackType = "text/plain") {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) {
    if (fileName === "site-config.js") {
      res.type("application/javascript").send("window.ITLIB_CONFIG = window.ITLIB_CONFIG || {};\n");
      return;
    }
    res.status(404).type(fallbackType).send("Not found");
    return;
  }
  res.sendFile(filePath);
}

app.get(["/", "/index.html"], (_req, res) => safeSendFile(res, "index.html"));
app.get("/style.css", (_req, res) => safeSendFile(res, "style.css", "text/css"));
app.get("/app.js", (_req, res) => safeSendFile(res, "app.js", "application/javascript"));
app.get("/quiz-auth.js", (_req, res) => safeSendFile(res, "quiz-auth.js", "application/javascript"));
app.get("/carousel.js", (_req, res) => safeSendFile(res, "carousel.js", "application/javascript"));
app.get("/site-config.js", (_req, res) => safeSendFile(res, "site-config.js", "application/javascript"));

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function parseToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function safeInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function trimText(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeImageUrl(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 1000);
}

async function getUserById(id) {
  const { rows } = await pool.query("SELECT id, username FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

async function auth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.uid);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = { uid: user.id, username: user.username };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function optionalAuth(req, _res, next) {
  const token = parseToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.uid);
    req.user = user ? { uid: user.id, username: user.username } : null;
  } catch {
    req.user = null;
  }

  next();
}

async function loadPosts(viewerId, { postId = null, userId = null, username = null, mine = false, limit = 30 } = {}) {
  const params = [viewerId ?? null];
  const where = [];
  let idx = 2;

  if (postId !== null) {
    where.push(`p.id = $${idx++}`);
    params.push(postId);
  }

  if (mine) {
    if (!viewerId) return [];
    where.push(`p.user_id = $${idx++}`);
    params.push(viewerId);
  } else if (userId !== null) {
    where.push(`p.user_id = $${idx++}`);
    params.push(userId);
  } else if (username) {
    where.push(`LOWER(u.username) = LOWER($${idx++})`);
    params.push(username);
  }

  params.push(limit);
  const limitIndex = params.length;

  const sql = `
    SELECT
      p.id,
      p.user_id,
      p.title,
      p.content,
      p.image_url,
      p.created_at,
      p.updated_at,
      u.username AS author_username,
      COALESCE(pl.likes_count, 0)::int AS likes_count,
      COALESCE(pc.comments_count, 0)::int AS comments_count,
      CASE
        WHEN $1::int IS NULL THEN FALSE
        ELSE EXISTS (
          SELECT 1
          FROM post_likes myl
          WHERE myl.post_id = p.id AND myl.user_id = $1
        )
      END AS liked_by_me,
      CASE
        WHEN $1::int IS NULL THEN FALSE
        ELSE p.user_id = $1
      END AS is_owner
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS likes_count
      FROM post_likes
      GROUP BY post_id
    ) pl ON pl.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS comments_count
      FROM post_comments
      GROUP BY post_id
    ) pc ON pc.post_id = p.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $${limitIndex}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function loadPostById(postId, viewerId) {
  const rows = await loadPosts(viewerId, { postId, limit: 1 });
  return rows[0] || null;
}

async function loadComments(postId, viewerId) {
  const { rows } = await pool.query(
    `
      SELECT
        c.id,
        c.post_id,
        c.user_id,
        c.content,
        c.created_at,
        c.updated_at,
        u.username,
        CASE WHEN $2::int IS NULL THEN FALSE ELSE c.user_id = $2 END AS can_delete
      FROM post_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC, c.id ASC
    `,
    [postId, viewerId ?? null]
  );
  return rows;
}

async function loadProfile(userId) {
  const { rows } = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.created_at,
        (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = u.id) AS posts_count,
        (SELECT COUNT(*)::int FROM post_comments c WHERE c.user_id = u.id) AS comments_count,
        (
          SELECT COUNT(*)::int
          FROM post_likes l
          JOIN posts p2 ON p2.id = l.post_id
          WHERE p2.user_id = u.id
        ) AS likes_received
      FROM users u
      WHERE u.id = $1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function loadProfileByUsername(username) {
  const { rows } = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.created_at,
        (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = u.id) AS posts_count,
        (SELECT COUNT(*)::int FROM post_comments c WHERE c.user_id = u.id) AS comments_count,
        (
          SELECT COUNT(*)::int
          FROM post_likes l
          JOIN posts p2 ON p2.id = l.post_id
          WHERE p2.user_id = u.id
        ) AS likes_received
      FROM users u
      WHERE LOWER(u.username) = LOWER($1)
    `,
    [username]
  );
  return rows[0] || null;
}

async function requirePostOwner(postId, userId) {
  const { rows } = await pool.query("SELECT id, user_id FROM posts WHERE id = $1", [postId]);
  if (!rows.length) return { ok: false, status: 404, error: "Post not found" };
  if (rows[0].user_id !== userId) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

async function requireCommentOwner(commentId, userId) {
  const { rows } = await pool.query("SELECT id, post_id, user_id FROM post_comments WHERE id = $1", [commentId]);
  if (!rows.length) return { ok: false, status: 404, error: "Comment not found" };
  if (rows[0].user_id !== userId) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, postId: rows[0].post_id };
}

app.get("/api/health", async (_req, res) => {
  try {
    const db = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, version: VERSION, dbTime: db.rows[0].now });
  } catch (error) {
    console.error("HEALTH ERROR:", error?.message || error);
    res.status(500).json({ ok: false, error: String(error?.message || error), version: VERSION });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = trimText(req.body?.username, 50);
    const password = String(req.body?.password ?? "");

    if (!username || !password) return res.status(400).json({ error: "username & password required" });
    if (username.length < 3) return res.status(400).json({ error: "username must be >= 3 chars" });
    if (password.length < 6) return res.status(400).json({ error: "password must be >= 6 chars" });

    const exists = await pool.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [username]);
    if (exists.rowCount) return res.status(409).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      "INSERT INTO users(username, password_hash) VALUES($1, $2) RETURNING id, username",
      [username, passwordHash]
    );

    const user = inserted.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    console.error("REGISTER ERROR:", error?.message || error);
    res.status(500).json({ error: "Register failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = trimText(req.body?.username, 50);
    const password = String(req.body?.password ?? "");

    if (!username || !password) return res.status(400).json({ error: "username & password required" });

    const found = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );

    if (!found.rowCount) return res.status(401).json({ error: "Invalid credentials" });

    const user = found.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error("LOGIN ERROR:", error?.message || error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.uid);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({ user });
  } catch (error) {
    console.error("ME ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load current user" });
  }
});

app.get("/api/profile/me", auth, async (req, res) => {
  try {
    const profile = await loadProfile(req.user.uid);
    const posts = await loadPosts(req.user.uid, { mine: true, limit: 20 });
    res.json({ profile, posts });
  } catch (error) {
    console.error("PROFILE ME ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

app.get("/api/profile/:username", optionalAuth, async (req, res) => {
  try {
    const username = trimText(req.params.username, 50);
    if (!username) return res.status(400).json({ error: "Invalid username" });

    const profile = await loadProfileByUsername(username);
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const posts = await loadPosts(req.user?.uid ?? null, { userId: profile.id, limit: 20 });
    res.json({ profile, posts });
  } catch (error) {
    console.error("PROFILE ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

app.get("/api/posts", optionalAuth, async (req, res) => {
  try {
    const mine = String(req.query.mine || "") === "1";
    if (mine && !req.user) return res.status(401).json({ error: "Missing token" });

    const userId = safeInt(req.query.user_id);
    const username = trimText(req.query.username, 50) || null;
    const limit = Math.min(Math.max(safeInt(req.query.limit, 20) || 20, 1), 100);

    const posts = await loadPosts(req.user?.uid ?? null, { mine, userId, username, limit });
    res.json({ posts });
  } catch (error) {
    console.error("GET POSTS ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load posts" });
  }
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const title = trimText(req.body?.title, 150);
    const content = trimText(req.body?.content, 5000);
    const imageUrl = normalizeImageUrl(req.body?.image_url);

    if (!title) return res.status(400).json({ error: "title required" });
    if (!content) return res.status(400).json({ error: "content required" });

    const inserted = await pool.query(
      `
        INSERT INTO posts(user_id, title, content, image_url)
        VALUES($1, $2, $3, $4)
        RETURNING id
      `,
      [req.user.uid, title, content, imageUrl]
    );

    const post = await loadPostById(inserted.rows[0].id, req.user.uid);
    res.status(201).json({ post });
  } catch (error) {
    console.error("CREATE POST ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to create post" });
  }
});

app.put("/api/posts/:id", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const owner = await requirePostOwner(postId, req.user.uid);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    const title = trimText(req.body?.title, 150);
    const content = trimText(req.body?.content, 5000);
    const imageUrl = normalizeImageUrl(req.body?.image_url);

    if (!title) return res.status(400).json({ error: "title required" });
    if (!content) return res.status(400).json({ error: "content required" });

    await pool.query(
      `
        UPDATE posts
        SET title = $1, content = $2, image_url = $3, updated_at = NOW()
        WHERE id = $4
      `,
      [title, content, imageUrl, postId]
    );

    const post = await loadPostById(postId, req.user.uid);
    res.json({ post });
  } catch (error) {
    console.error("UPDATE POST ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const owner = await requirePostOwner(postId, req.user.uid);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    await pool.query("DELETE FROM posts WHERE id = $1", [postId]);
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE POST ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

app.post("/api/posts/:id/like", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const post = await loadPostById(postId, req.user.uid);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const existing = await pool.query("SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2", [postId, req.user.uid]);

    let liked = false;
    if (existing.rowCount) {
      await pool.query("DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2", [postId, req.user.uid]);
      liked = false;
    } else {
      await pool.query(
        "INSERT INTO post_likes(post_id, user_id) VALUES($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING",
        [postId, req.user.uid]
      );
      liked = true;
    }

    const fresh = await loadPostById(postId, req.user.uid);
    res.json({ liked, post: fresh });
  } catch (error) {
    console.error("LIKE ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to toggle like post" });
  }
});

app.get("/api/posts/:id/comments", optionalAuth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const exists = await loadPostById(postId, req.user?.uid ?? null);
    if (!exists) return res.status(404).json({ error: "Post not found" });

    const comments = await loadComments(postId, req.user?.uid ?? null);
    res.json({ comments });
  } catch (error) {
    console.error("GET COMMENTS ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load comments" });
  }
});

app.post("/api/posts/:id/comments", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const content = trimText(req.body?.content, 1000);
    if (!content) return res.status(400).json({ error: "comment content required" });

    const exists = await loadPostById(postId, req.user.uid);
    if (!exists) return res.status(404).json({ error: "Post not found" });

    await pool.query(
      `
        INSERT INTO post_comments(post_id, user_id, content)
        VALUES($1, $2, $3)
      `,
      [postId, req.user.uid, content]
    );

    const comments = await loadComments(postId, req.user.uid);
    res.status(201).json({ comments });
  } catch (error) {
    console.error("CREATE COMMENT ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

app.delete("/api/comments/:id", auth, async (req, res) => {
  try {
    const commentId = safeInt(req.params.id);
    if (!commentId) return res.status(400).json({ error: "Invalid comment id" });

    const owner = await requireCommentOwner(commentId, req.user.uid);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    await pool.query("DELETE FROM post_comments WHERE id = $1", [commentId]);
    res.json({ ok: true, post_id: owner.postId });
  } catch (error) {
    console.error("DELETE COMMENT ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

app.get("/api/quiz/questions", auth, async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.n || 10), 1), 50);
    const result = await pool.query(
      `
        SELECT id, question, choice_a, choice_b, choice_c, choice_d
        FROM questions
        ORDER BY RANDOM()
        LIMIT $1
      `,
      [n]
    );

    const questions = result.rows.map((q) => ({
      id: q.id,
      question: q.question,
      choices: [q.choice_a, q.choice_b, q.choice_c, q.choice_d],
    }));

    res.json({ questions });
  } catch (error) {
    console.error("QUESTIONS ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load questions" });
  }
});

app.post("/api/quiz/submit", auth, async (req, res) => {
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!answers.length) return res.status(400).json({ error: "answers required" });
    if (answers.length > 50) return res.status(400).json({ error: "too many answers" });

    const ids = [...new Set(answers.map((a) => Number(a.id)).filter(Number.isFinite))];
    if (!ids.length) return res.status(400).json({ error: "invalid question ids" });

    const found = await pool.query("SELECT id, correct_index FROM questions WHERE id = ANY($1::int[])", [ids]);
    const correct = new Map(found.rows.map((row) => [row.id, row.correct_index]));

    let score = 0;
    let total = 0;

    for (const answer of answers) {
      const qid = Number(answer.id);
      const choiceIndex = Number(answer.choiceIndex);
      if (!correct.has(qid)) continue;
      if (!Number.isFinite(choiceIndex)) continue;
      total += 1;
      if (choiceIndex === correct.get(qid)) score += 1;
    }

    const saved = await pool.query(
      "INSERT INTO scores(user_id, score, total) VALUES($1, $2, $3) RETURNING id, score, total, created_at",
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
  } catch (error) {
    console.error("SUBMIT ERROR:", error?.message || error);
    res.status(500).json({ error: "Submit failed" });
  }
});

app.get("/api/scoreboard", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const result = await pool.query(
      `
        SELECT s.id, u.username, s.score, s.total, s.created_at
        FROM scores s
        JOIN users u ON u.id = s.user_id
        ORDER BY
          (CASE WHEN s.total = 0 THEN 0 ELSE (s.score::float / s.total) END) DESC,
          s.score DESC,
          s.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    res.json({ rows: result.rows });
  } catch (error) {
    console.error("SCOREBOARD ERROR:", error?.message || error);
    res.status(500).json({ error: "Failed to load scoreboard" });
  }
});

app.get("/api/version", (_req, res) => {
  res.json({ version: VERSION });
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }
  safeSendFile(res, "index.html");
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});