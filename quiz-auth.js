// quiz-auth.js — DROP-IN FINAL (วางทับทั้งไฟล์)

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const API = {
    me: "/api/me",
    login: "/api/auth/login",
    register: "/api/auth/register",
    questions: (n) => `/api/quiz/questions?n=${encodeURIComponent(n)}`,
    submit: "/api/quiz/submit",
    scoreboard: (limit = 10) => `/api/scoreboard?limit=${encodeURIComponent(limit)}`,
  };

  const state = {
    token: localStorage.getItem("token") || "",
    user: null,
    mode: "login",
    questions: [],
    submitting: false,
  };

  const log = (...args) => console.log("[quiz-auth]", ...args);

  function authHeader() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Inject top logout + status (no need edit index.html) ----------
  function ensureTopAuthUI() {
    let logoutBtn = document.getElementById("btnLogoutTop");
    let statusEl = document.getElementById("loginStatus");

    if (logoutBtn && statusEl) return { logoutBtn, statusEl };

    // Try to find a reasonable container
    const container =
      document.querySelector(".topbar .right") ||
      document.querySelector(".topbar") ||
      document.querySelector("header") ||
      document.body;

    if (!statusEl) {
      statusEl = document.createElement("span");
      statusEl.id = "loginStatus";
      statusEl.style.marginLeft = "8px";
      statusEl.style.fontSize = "13px";
      statusEl.style.opacity = "0.85";
      container.appendChild(statusEl);
    }

    if (!logoutBtn) {
      logoutBtn = document.createElement("button");
      logoutBtn.id = "btnLogoutTop";
      logoutBtn.textContent = "Logout";
      // try reuse your button style if exists
      logoutBtn.className = "quiz-btn ghost";
      logoutBtn.style.display = "none";
      logoutBtn.style.marginLeft = "8px";
      container.appendChild(logoutBtn);
    }

    return { logoutBtn, statusEl };
  }

  function setLoginUI(isLoggedIn) {
    const { logoutBtn, statusEl } = ensureTopAuthUI();
    logoutBtn.style.display = isLoggedIn ? "inline-block" : "none";
    statusEl.textContent = isLoggedIn ? `Login: ${state.user?.username ?? ""}` : "ยังไม่ได้ Login";
  }

  // ---------- Modal (Login/Register) ----------
  function ensureModal() {
    let overlay = $("#qaOverlay");
    if (overlay) return overlay;

    const style = document.createElement("style");
    style.textContent = `
      .qa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:99999}
      .qa-modal{width:min(520px,92vw);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
      .qa-row{display:flex;gap:10px;align-items:center;justify-content:space-between}
      .qa-tabs{display:flex;gap:8px;margin:10px 0}
      .qa-tab{padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cbd5e1;cursor:pointer}
      .qa-tab.active{background:rgba(34,211,238,.15);border-color:rgba(34,211,238,.45);color:#e2e8f0}
      .qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .qa-label{font-size:12px;color:#cbd5e1;margin-bottom:6px}
      .qa-input{width:100%;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#e5e7eb;outline:none}
      .qa-btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e5e7eb;cursor:pointer;font-weight:700}
      .qa-btn.primary{border-color:rgba(34,211,238,.55);background:rgba(34,211,238,.18)}
      .qa-msg{margin-top:10px;color:#cbd5e1}
      .qa-msg.bad{color:#fb7185}
      .qa-msg.good{color:#34d399}
      .qa-hidden{display:none !important}
    `;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "qaOverlay";
    overlay.className = "qa-overlay";
    overlay.innerHTML = `
      <div class="qa-modal">
        <div class="qa-row">
          <div style="font-weight:900">Login required</div>
          <button class="qa-btn" id="qaClose">ปิด</button>
        </div>

        <div class="qa-tabs">
          <button class="qa-tab active" id="qaTabLogin">Login</button>
          <button class="qa-tab" id="qaTabRegister">Register</button>
        </div>

        <div class="qa-grid">
          <div>
            <div class="qa-label">Username</div>
            <input class="qa-input" id="qaUsername" placeholder="อย่างน้อย 3 ตัวอักษร" />
          </div>
          <div>
            <div class="qa-label">Password</div>
            <input class="qa-input" id="qaPassword" type="password" placeholder="อย่างน้อย 6 ตัวอักษร" />
          </div>
        </div>

        <div style="margin-top:12px" class="qa-row">
          <button class="qa-btn primary" id="qaSubmit">Login</button>
        </div>

        <div class="qa-msg" id="qaMsg"></div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(overlay);

    const setMsg = (text, type = "") => {
      const el = $("#qaMsg");
      el.textContent = text || "";
      el.classList.remove("bad", "good");
      if (type) el.classList.add(type);
    };

    const setMode = (mode) => {
      state.mode = mode;
      $("#qaTabLogin").classList.toggle("active", mode === "login");
      $("#qaTabRegister").classList.toggle("active", mode === "register");
      $("#qaSubmit").textContent = mode === "login" ? "Login" : "Register";
      setMsg("");
    };

    const open = () => (overlay.style.display = "flex");
    const close = () => (overlay.style.display = "none");

    $("#qaClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    $("#qaTabLogin").addEventListener("click", () => setMode("login"));
    $("#qaTabRegister").addEventListener("click", () => setMode("register"));

    $("#qaSubmit").addEventListener("click", async () => {
      const username = $("#qaUsername").value.trim();
      const password = $("#qaPassword").value;

      setMsg("กำลังทำรายการ...");
      try {
        const endpoint = state.mode === "login" ? API.login : API.register;
        const data = await api(endpoint, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });

        state.token = data.token;
        localStorage.setItem("token", state.token);
        state.user = data.user;

        setMsg("สำเร็จ!", "good");
        close();

        setLoginUI(true);
        unlockQuizUI();
        await openQuizPage();
      } catch (e) {
        setMsg(e.message, "bad");
      }
    });

    overlay.__api = { open, close, setMode };
    return overlay;
  }

  async function ensureLogin() {
    if (!state.token) return false;
    try {
      const me = await api(API.me, { headers: authHeader() });
      state.user = me.user;
      return true;
    } catch {
      state.token = "";
      state.user = null;
      localStorage.removeItem("token");
      return false;
    }
  }

  // ---------- Show topic #quiz ----------
  function showQuizTopic() {
    if (typeof window.ITLIB_showTopic === "function") {
      window.ITLIB_showTopic("quiz");
      return;
    }
    const quiz = document.getElementById("quiz");
    if (quiz) quiz.style.display = "block";
  }

  // ---------- Grab existing HTML elements ----------
  function els() {
    return {
      quizArticle: document.getElementById("quiz"),
      playerName: document.getElementById("playerName"),
      quizMode: document.getElementById("quizMode"),
      btnStart: document.getElementById("btnStartQuiz"),
      btnReset: document.getElementById("btnResetQuiz"),
      quizStage: document.getElementById("quizStage"),
      lbStatus: document.getElementById("lbStatus"),
      lbBody: document.getElementById("lbBody"),
    };
  }

  function setText(el, txt) {
    if (el) el.textContent = txt ?? "";
  }

  // ---------- Lock/Unlock quiz UI ----------
  function lockQuizUI() {
    const e = els();
    if (e.btnStart) e.btnStart.disabled = true;
    if (e.btnReset) e.btnReset.disabled = true;

    if (e.playerName) {
      e.playerName.value = "";
      e.playerName.readOnly = true;
      e.playerName.placeholder = "กรุณา Login ก่อนเล่น";
    }

    if (e.quizStage) {
      e.quizStage.innerHTML = `<div class="muted">กรุณา Login ก่อนเริ่มเกม</div>`;
    }
  }

  function unlockQuizUI() {
    const e = els();
    if (e.btnStart) e.btnStart.disabled = false;
    // reset เปิดทีหลังตาม flow
    if (e.playerName && state.user?.username) {
      e.playerName.value = state.user.username;
      e.playerName.readOnly = true;
    }
  }

  function doLogout() {
    state.token = "";
    state.user = null;
    localStorage.removeItem("token");

    setLoginUI(false);
    lockQuizUI();
    // ✅ ไม่แตะ leaderboard — ให้คะแนนเดิมยังอยู่
  }

  // ---------- Leaderboard ----------
  async function refreshLeaderboard() {
    const e = els();
    setText(e.lbStatus, "กำลังโหลด...");
    try {
      const data = await api(API.scoreboard(10));
      const rows = data.rows || [];
      if (!e.lbBody) return;

      if (!rows.length) {
        e.lbBody.innerHTML = `<tr><td colspan="4" class="muted">ยังไม่มีคะแนน</td></tr>`;
      } else {
        e.lbBody.innerHTML = rows
          .slice(0, 10)
          .map((r, i) => {
            const pct = r.total ? Math.round((Number(r.score) / Number(r.total)) * 100) : 0;
            const t = new Date(r.created_at).toLocaleString();
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.username)}</td>
                <td>${r.score}/${r.total} (${pct}%)</td>
                <td>${escapeHtml(t)}</td>
              </tr>
            `;
          })
          .join("");
      }

      setText(e.lbStatus, "อัปเดตล่าสุดแล้ว");
    } catch (err) {
      setText(e.lbStatus, `Error: ${err.message}`);
    }
  }

  // ---------- Quiz render/submit ----------
  function renderQuestions(questions) {
    const e = els();
    if (!e.quizStage) return;

    e.quizStage.innerHTML = questions
      .map((q, idx) => {
        const choices = q.choices
          .map(
            (c, cidx) => `
              <label class="choice" style="display:flex;gap:10px;align-items:center;margin:6px 0;">
                <input type="radio" name="q_${q.id}" value="${cidx}" data-qid="${q.id}">
                <span>${escapeHtml(c)}</span>
              </label>
            `
          )
          .join("");

        return `
          <div class="q" style="padding:12px;border:1px solid rgba(0,0,0,.08);border-radius:12px;margin:10px 0;background:#fff;">
            <div class="qtitle" style="font-weight:900;margin-bottom:10px;">${idx + 1}. ${escapeHtml(
              q.question
            )}</div>
            <div class="choices">${choices}</div>
          </div>
        `;
      })
      .join("");

    // ยึดปุ่มส่งคำตอบทุกตัวใน #quiz (กัน listener เก่า)
    rebindSubmitButtons();
  }

  function collectAnswers() {
    const quiz = document.getElementById("quiz");
    if (!quiz) return [];

    const checked = Array.from(quiz.querySelectorAll('input[type="radio"]:checked'));
    const map = new Map();

    for (const el of checked) {
      const qid = Number(el.dataset.qid);
      const choiceIndex = Number(el.value);
      if (Number.isFinite(qid) && Number.isFinite(choiceIndex)) {
        map.set(qid, choiceIndex);
      }
    }
    return Array.from(map.entries()).map(([id, choiceIndex]) => ({ id, choiceIndex }));
  }

  // ลบ listener เก่าโดย clone ปุ่ม แล้ว bind ใหม่ให้เรียก submitQuiz() เท่านั้น
  function rebindSubmitButtons() {
    const quiz = document.getElementById("quiz");
    if (!quiz) return;

    // candidate: id มี submit หรือข้อความมี “ส่งคำตอบ”
    const candidates = $$("button", quiz).filter((b) => {
      const t = (b.textContent || "").trim();
      const id = (b.id || "").toLowerCase();
      return id.includes("submit") || t.includes("ส่งคำตอบ") || t.toLowerCase().includes("submit");
    });

    for (const btn of candidates) {
      const fresh = btn.cloneNode(true);
      btn.replaceWith(fresh);
      fresh.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          submitQuiz();
        },
        true
      );
    }

    // ถ้าไม่มีปุ่มส่งเลย ให้สร้างไว้ใต้ stage
    const stage = document.getElementById("quizStage");
    if (candidates.length === 0 && stage && !document.getElementById("qaSubmitAuto")) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.justifyContent = "flex-end";
      wrap.style.marginTop = "12px";

      const btn = document.createElement("button");
      btn.id = "qaSubmitAuto";
      btn.className = "quiz-btn";
      btn.textContent = "ส่งคำตอบ";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        submitQuiz();
      });

      wrap.appendChild(btn);
      stage.appendChild(wrap);
    }
  }

  async function startQuiz() {
    const e = els();
    if (!e.quizStage) return;

    // ต้อง login ก่อนเริ่มเกม
    const ok = await ensureLogin();
    if (!ok) {
      setLoginUI(false);
      lockQuizUI();
      const modal = ensureModal();
      modal.__api.setMode("login");
      modal.__api.open();
      return;
    }

    const n = Number(e.quizMode?.value || 10);
    e.quizStage.innerHTML = `<div class="muted">กำลังโหลดคำถาม...</div>`;

    try {
      const data = await api(API.questions(n), { headers: authHeader() });
      state.questions = data.questions || [];
      if (!state.questions.length) {
        e.quizStage.innerHTML = `<div class="muted">ไม่มีคำถามในระบบ</div>`;
        return;
      }
      if (e.btnReset) e.btnReset.disabled = false;
      renderQuestions(state.questions);
    } catch (err) {
      e.quizStage.innerHTML = `<div class="muted">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function resetQuiz() {
    state.questions = [];
    const e = els();
    if (e.quizStage) {
      e.quizStage.innerHTML = `<div class="muted">กด “เริ่มเกม” เพื่อโหลดคำถามจากเซิร์ฟเวอร์</div>`;
    }
    if (e.btnReset) e.btnReset.disabled = true;
    rebindSubmitButtons();
  }

  async function submitQuiz() {
    if (state.submitting) return;
    state.submitting = true;

    // ใช้ element ที่มึงมีอยู่เดิม (ถ้ามี)
    let resultEl = document.getElementById("quizResultMsg");
    if (!resultEl) {
      // ถ้าไม่มี ก็สร้างไว้ใต้ stage
      const stage = document.getElementById("quizStage");
      if (stage) {
        resultEl = document.createElement("div");
        resultEl.id = "quizResultMsg";
        resultEl.className = "muted small";
        resultEl.style.marginTop = "8px";
        stage.appendChild(resultEl);
      }
    }

    try {
      const ok = await ensureLogin();
      if (!ok) {
        if (resultEl) resultEl.textContent = "กรุณา Login ก่อนส่งคำตอบ";
        setLoginUI(false);
        lockQuizUI();
        const modal = ensureModal();
        modal.__api.setMode("login");
        modal.__api.open();
        return;
      }

      const answers = collectAnswers();
      log("answers:", answers);

      if (!answers.length) {
        if (resultEl) resultEl.textContent = "กรุณาเลือกคำตอบก่อนส่ง (answers = 0)";
        return;
      }

      // บังคับตอบครบทุกข้อ ลดเคสคนกดส่งทั้งที่ตอบไม่ครบ
      if (state.questions.length && answers.length !== state.questions.length) {
        if (resultEl) resultEl.textContent = `ตอบไม่ครบ: ${answers.length}/${state.questions.length} ข้อ — ตอบให้ครบก่อนส่ง`;
        return;
      }

      if (resultEl) resultEl.textContent = "กำลังส่งคำตอบ...";

      const data = await api(API.submit, {
        method: "POST",
        headers: { ...authHeader() },
        body: JSON.stringify({ answers }),
      });

      const r = data.result;
      if (resultEl) resultEl.textContent = `ผลคะแนน: ${r.score}/${r.total} (${r.percent}%) — บันทึกคะแนนแล้ว`;
      await refreshLeaderboard();
    } catch (err) {
      if (resultEl) resultEl.textContent = `Error: ${err.message}`;
    } finally {
      state.submitting = false;
    }
  }

  async function openQuizPage() {
    showQuizTopic();

    const e = els();
    if (!e.quizArticle) return;

    // bind start/reset ครั้งเดียว
    if (e.btnStart && !e.btnStart.__bound) {
      e.btnStart.addEventListener("click", (ev) => {
        ev.preventDefault();
        startQuiz();
      });
      e.btnStart.__bound = true;
    }
    if (e.btnReset && !e.btnReset.__bound) {
      e.btnReset.addEventListener("click", (ev) => {
        ev.preventDefault();
        resetQuiz();
      });
      e.btnReset.__bound = true;
    }

    // update UI (locked/unlocked) + leaderboard
    const ok = await ensureLogin();
    setLoginUI(ok);
    if (!ok) lockQuizUI();
    else unlockQuizUI();

    // bind logout button
    const { logoutBtn } = ensureTopAuthUI();
    if (!logoutBtn.__bound) {
      logoutBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        doLogout();
      });
      logoutBtn.__bound = true;
    }

    // ยึดปุ่มส่งทุกตัวใน quiz กัน listener เก่า
    rebindSubmitButtons();

    await refreshLeaderboard();
  }

  // hook menu quiz
  function hookQuizMenu() {
    const links = $$('a[data-menu="quiz"], a[data-target="quiz"]');
    links.forEach((a) => {
      if (a.__qa_bound) return;
      a.__qa_bound = true;

      a.addEventListener(
        "click",
        async (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();

          const ok = await ensureLogin();
          if (!ok) {
            setLoginUI(false);
            lockQuizUI();
            const modal = ensureModal();
            modal.__api.setMode("login");
            modal.__api.open();
            return;
          }
          await openQuizPage();
        },
        true
      );
    });
  }

  // BOOT
  window.addEventListener("DOMContentLoaded", async () => {
    ensureTopAuthUI(); // inject logout/status if missing
    ensureModal();
    hookQuizMenu();

    const ok = await ensureLogin();
    setLoginUI(ok);
    if (!ok) lockQuizUI();

    // bind logout always
    const { logoutBtn } = ensureTopAuthUI();
    if (!logoutBtn.__bound) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        doLogout();
      });
      logoutBtn.__bound = true;
    }
  });
})();