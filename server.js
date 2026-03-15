const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_me_super_secret";

const ALLOW_ORIGINS = new Set([
  "https://project-mek-pup.vercel.app",
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

app.use(
  express.json({
    limit: "2mb",
    type: ["application/json", "application/*+json", "text/json", "*/*"],
    verify: (req, _res, buf) => {
      req.rawBody = buf?.toString?.("utf8") || "";
    },
  })
);
app.use(express.urlencoded({ extended: true }));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "postgres",
    });

app.use(express.static(__dirname));
app.use("/assets", express.static(path.join(__dirname, "assets")));

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function parseToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : header;
}

async function getUserById(id) {
  const r = await pool.query(
    "SELECT id, username FROM users WHERE id = $1",
    [id]
  );
  return r.rows[0] || null;
}

async function auth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const dbUser = await getUserById(payload.uid);

    if (!dbUser) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = { uid: dbUser.id, username: dbUser.username };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
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
    const dbUser = await getUserById(payload.uid);

    if (!dbUser) {
      req.user = null;
      return next();
    }

    req.user = { uid: dbUser.id, username: dbUser.username };
  } catch {
    req.user = null;
  }

  next();
}

function safeInt(v, fallback = null) {
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}

function trimText(v, max = 5000) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeImageUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 1000);
}

async function loadPosts(
  viewerId,
  { postId = null, userId = null, username = null, mine = false, limit = 30 } = {}
) {
  const where = [];
  const params = [viewerId ?? null, viewerId ?? null, viewerId ?? null, viewerId ?? null];
  let idx = 5;

  if (postId !== null) {
    where.push(`p.id = $${idx++}`);
    params.push(postId);
  }

  if (mine) {
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
      COALESCE(pl.likes_count, 0) AS likes_count,
      COALESCE(pc.comments_count, 0) AS comments_count,
      CASE
        WHEN $1 IS NULL THEN FALSE
        ELSE EXISTS (
          SELECT 1
          FROM post_likes myl
          WHERE myl.post_id = p.id AND myl.user_id = $2
        )
      END AS liked_by_me,
      CASE
        WHEN $3 IS NULL THEN FALSE
        ELSE p.user_id = $4
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
    ORDER BY p.created_at DESC
    LIMIT $${limitIndex}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function loadPosts(
  viewerId,
  { postId = null, userId = null, username = null, mine = false, limit = 30 } = {}
) {
  const params = [viewerId ?? null];
  const where = [];
  let idx = 2;

  if (postId !== null) {
    where.push(`p.id = $${idx++}`);
    params.push(postId);
  }

  if (mine) {
    where.push(`p.user_id = $${idx++}`);
    params.push(viewerId);
  } else if (userId !== null) {
    where.push(`p.user_id = $${idx++}`);
    params.push(userId);
  } else if (username) {
    where.push(`LOWER(u.username) = LOWER($${idx++})`);
    params.push(username);
  }

  const limitIndex = idx;
  params.push(limit);

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
    ORDER BY p.created_at DESC
    LIMIT $${limitIndex}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
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
        CASE
          WHEN $2::int IS NULL THEN FALSE
          ELSE c.user_id = $2
        END AS can_delete
      FROM post_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
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
  const { rows } = await pool.query("SELECT id, user_id FROM posts WHERE id=$1", [postId]);
  if (!rows.length) return { ok: false, status: 404, error: "Post not found" };
  if (rows[0].user_id !== userId) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

async function requireCommentOwner(commentId, userId) {
  const { rows } = await pool.query("SELECT id, post_id, user_id FROM post_comments WHERE id=$1", [commentId]);
  if (!rows.length) return { ok: false, status: 404, error: "Comment not found" };
  if (rows[0].user_id !== userId) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, postId: rows[0].post_id };
}

app.get("/api/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, dbTime: r.rows[0].now });
  } catch (e) {
    console.error("HEALTH DB ERROR:", e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = trimText(req.body?.username, 50);
    const password = String(req.body?.password ?? "");

    if (!username || !password) return res.status(400).json({ error: "username & password required" });
    if (username.length < 3) return res.status(400).json({ error: "username must be >= 3 chars" });
    if (password.length < 6) return res.status(400).json({ error: "password must be >= 6 chars" });

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
    const username = trimText(req.body?.username, 50);
    const password = String(req.body?.password ?? "");

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

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.uid);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({ user });
  } catch (e) {
    console.error("ME ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load current user" });
  }
});

app.get("/api/profile/me", auth, async (req, res) => {
  try {
    const profile = await loadProfile(req.user.uid);
    const posts = await loadPosts(req.user.uid, { mine: true, limit: 20 });
    res.json({ profile, posts });
  } catch (e) {
    console.error("PROFILE ME ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

app.get("/api/profile/:username", optionalAuth, async (req, res) => {
  try {
    const username = trimText(req.params.username, 50);
    if (!username) return res.status(400).json({ error: "Invalid username" });

    const profile = await loadProfileByUsername(username);
    if (!profile) return res.status(404).json({ error: "User not found" });

    const posts = await loadPosts(req.user?.uid ?? null, { userId: profile.id, limit: 20 });
    res.json({ profile, posts });
  } catch (e) {
    console.error("PROFILE USER ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

app.get("/api/posts", optionalAuth, async (req, res) => {
  try {
    const mine = String(req.query.mine || "") === "1";
    if (mine && !req.user) return res.status(401).json({ error: "Missing token" });

    const userId = safeInt(req.query.user_id);
    const username = trimText(req.query.username, 50);
    const limit = Math.min(Math.max(safeInt(req.query.limit, 20) || 20, 1), 100);

    const posts = await loadPosts(req.user?.uid ?? null, {
      mine,
      userId,
      username: username || null,
      limit,
    });

    res.json({ posts });
  } catch (e) {
    console.error("GET POSTS ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load posts" });
  }
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const dbUser = await getUserById(req.user.uid);
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const title = trimText(req.body?.title, 150);
    const content = trimText(req.body?.content, 5000);
    const image_url = normalizeImageUrl(req.body?.image_url);

    if (!title) return res.status(400).json({ error: "title required" });
    if (!content) return res.status(400).json({ error: "content required" });

    const inserted = await pool.query(
      `
        INSERT INTO posts(user_id, title, content, image_url)
        VALUES($1,$2,$3,$4)
        RETURNING id
      `,
      [dbUser.id, title, content, image_url]
    );

    const post = await loadPostById(inserted.rows[0].id, dbUser.id);
    res.status(201).json({ post });
  } catch (e) {
    console.error("CREATE POST ERROR:", e?.message || e);
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
    const image_url = normalizeImageUrl(req.body?.image_url);

    if (!title) return res.status(400).json({ error: "title required" });
    if (!content) return res.status(400).json({ error: "content required" });

    await pool.query(
      `
        UPDATE posts
        SET title=$1, content=$2, image_url=$3, updated_at=NOW()
        WHERE id=$4
      `,
      [title, content, image_url, postId]
    );

    const post = await loadPostById(postId, req.user.uid);
    res.json({ post });
  } catch (e) {
    console.error("UPDATE POST ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const owner = await requirePostOwner(postId, req.user.uid);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    await pool.query("DELETE FROM posts WHERE id=$1", [postId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE POST ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

app.post("/api/posts/:id/like", auth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const post = await loadPostById(postId, req.user.uid);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const existing = await pool.query(
      "SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2",
      [postId, req.user.uid]
    );

    let liked = false;

    if (existing.rowCount) {
      await pool.query("DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2", [postId, req.user.uid]);
      liked = false;
    } else {
      await pool.query(
        "INSERT INTO post_likes(post_id, user_id) VALUES($1,$2) ON CONFLICT (post_id, user_id) DO NOTHING",
        [postId, req.user.uid]
      );
      liked = true;
    }

    const fresh = await loadPostById(postId, req.user.uid);
    res.json({ liked, post: fresh });
  } catch (e) {
    console.error("LIKE TOGGLE ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to toggle like post" });
  }
});

app.get("/api/posts/:id/comments", optionalAuth, async (req, res) => {
  try {
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: "Invalid post id" });

    const comments = await loadComments(postId, req.user?.uid ?? null);
    res.json({ comments });
  } catch (e) {
    console.error("GET COMMENTS ERROR:", e?.message || e);
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
        VALUES($1,$2,$3)
      `,
      [postId, req.user.uid, content]
    );

    const comments = await loadComments(postId, req.user.uid);
    res.status(201).json({ comments });
  } catch (e) {
    console.error("CREATE COMMENT ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

app.delete("/api/comments/:id", auth, async (req, res) => {
  try {
    const commentId = safeInt(req.params.id);
    if (!commentId) return res.status(400).json({ error: "Invalid comment id" });

    const owner = await requireCommentOwner(commentId, req.user.uid);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    await pool.query("DELETE FROM post_comments WHERE id=$1", [commentId]);
    res.json({ ok: true, post_id: owner.postId });
  } catch (e) {
    console.error("DELETE COMMENT ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

app.get("/api/quiz/questions", auth, async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.n || 10), 1), 50);
    const r = await pool.query(
      `
        SELECT id, question, choice_a, choice_b, choice_c, choice_d
        FROM questions
        ORDER BY RANDOM()
        LIMIT $1
      `,
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

app.get("/api/scoreboard", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const r = await pool.query(
      `
        SELECT s.id, u.username, s.score, s.total, s.created_at
        FROM scores s
        JOIN users u ON u.id = s.user_id
        ORDER BY
          (CASE WHEN s.total=0 THEN 0 ELSE (s.score::float / s.total) END) DESC,
          s.score DESC,
          s.created_at DESC
        LIMIT $1
      `,
      [limit]
    );
    res.json({ rows: r.rows });
  } catch (e) {
    console.error("SCOREBOARD ERROR:", e?.message || e);
    res.status(500).json({ error: "Failed to load scoreboard" });
  }
});

app.get("/api/version", (_req, res) => {
  res.json({ version: "community-fix-2026-03-15-01" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

