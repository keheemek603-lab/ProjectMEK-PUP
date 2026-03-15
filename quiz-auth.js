(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

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

  function resolveApiBase() {
    const globalBase = window.ITLIB_CONFIG?.API_BASE;
    const metaBase = document.querySelector('meta[name="itlib-api-base"]')?.content;
    const base = String(globalBase || metaBase || "").trim();
    return base.replace(/\/+$/, "");
  }

  function toApiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = resolveApiBase();
    if (!base) return path;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function authHeader() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };

    if (!(opts.body instanceof FormData)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }

    const res = await fetch(toApiUrl(path), {
      ...opts,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function ensureTopAuthUI() {
    let wrap = document.getElementById("topbarAuth");
    if (!wrap) {
      const topbar = document.querySelector(".topbar") || document.querySelector("header") || document.body;
      wrap = document.createElement("div");
      wrap.id = "topbarAuth";
      wrap.className = "right";
      topbar.appendChild(wrap);
    }

    let statusEl = document.getElementById("loginStatus");
    let loginBtn = document.getElementById("btnLoginTop");
    let logoutBtn = document.getElementById("btnLogoutTop");

    if (!statusEl) {
      statusEl = document.createElement("span");
      statusEl.id = "loginStatus";
      wrap.appendChild(statusEl);
    }

    if (!loginBtn) {
      loginBtn = document.createElement("button");
      loginBtn.id = "btnLoginTop";
      loginBtn.type = "button";
      loginBtn.textContent = "Sign in";
      loginBtn.className = "quiz-btn ghost";
      wrap.appendChild(loginBtn);
    }

    if (!logoutBtn) {
      logoutBtn = document.createElement("button");
      logoutBtn.id = "btnLogoutTop";
      logoutBtn.type = "button";
      logoutBtn.textContent = "Sign out";
      logoutBtn.className = "quiz-btn ghost";
      wrap.appendChild(logoutBtn);
    }

    return { wrap, statusEl, loginBtn, logoutBtn };
  }

  function setLoginUI(isLoggedIn) {
    const { statusEl, loginBtn, logoutBtn } = ensureTopAuthUI();
    if (isLoggedIn) {
      statusEl.textContent = `สวัสดี, ${state.user?.username || ""}`;
      loginBtn.style.display = "inline-flex";
      loginBtn.hidden = true;
      logoutBtn.style.display = "inline-flex";
      logoutBtn.hidden = false;
    } else {
      statusEl.textContent = "Guest";
      loginBtn.style.display = "inline-flex";
      loginBtn.hidden = false;
      logoutBtn.style.display = "inline-flex";
      logoutBtn.hidden = true;
    }
  }

  function notifyAuthChanged() {
    window.dispatchEvent(
      new CustomEvent("itlib-auth-changed", {
        detail: {
          loggedIn: !!state.token,
          user: state.user,
          token: state.token,
        },
      })
    );
  }

  function doLogout() {
    state.token = "";
    state.user = null;
    state.questions = [];
    localStorage.removeItem("token");
    setLoginUI(false);
    notifyAuthChanged();
    renderQuizStage();
    updatePlayerLabel();
  }

  async function ensureLogin() {
    if (!state.token) {
      state.user = null;
      setLoginUI(false);
      return false;
    }

    try {
      const me = await api(API.me, { headers: authHeader() });
      state.user = me.user;
      setLoginUI(true);
      notifyAuthChanged();
      updatePlayerLabel();
      return true;
    } catch {
      doLogout();
      return false;
    }
  }

  function ensureModal() {
    let overlay = $("#qaOverlay");
    if (overlay) return overlay;

    const style = document.createElement("style");
    style.textContent = `
      .qa-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:99999}
      .qa-modal{width:min(520px,92vw);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
      .qa-row{display:flex;gap:10px;align-items:center;justify-content:space-between}
      .qa-tabs{display:flex;gap:8px;margin:10px 0}
      .qa-tab{padding:8px 10px;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cbd5e1}
      .qa-tab.active{background:rgba(34,211,238,.15);border-color:rgba(34,211,238,.45);color:#e2e8f0}
      .qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .qa-label{font-size:12px;color:#cbd5e1;margin-bottom:6px}
      .qa-input{width:100%;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#e5e7eb;outline:none}
      .qa-btn{padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:700;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e5e7eb}
      .qa-btn.primary{border-color:rgba(34,211,238,.55);background:rgba(34,211,238,.18)}
      .qa-msg{margin-top:10px;color:#cbd5e1}
      .qa-msg.bad{color:#fb7185}
      .qa-msg.good{color:#34d399}
      .quiz-question{border:1px solid var(--line2,#e6f6e6);border-radius:12px;padding:12px;margin:12px 0;background:#fff}
      .quiz-choice{display:flex;gap:10px;align-items:flex-start;padding:8px 0}
      .quiz-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
      .score-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(0,0,0,.08)}
      .quiz-result{margin:12px 0;padding:12px;border-radius:12px;background:#f7fff7;border:1px solid #cfe9cf;font-weight:800}
    `;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "qaOverlay";
    overlay.className = "qa-overlay";
    overlay.innerHTML = `
      <div class="qa-modal">
        <div class="qa-row">
          <div style="font-weight:900">Account</div>
          <button class="qa-btn" id="qaClose" type="button">ปิด</button>
        </div>

        <div class="qa-tabs">
          <button class="qa-tab active" id="qaTabLogin" type="button">Login</button>
          <button class="qa-tab" id="qaTabRegister" type="button">Sign up</button>
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
          <button class="qa-btn primary" id="qaSubmit" type="button">Login</button>
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
      $("#qaSubmit").textContent = mode === "login" ? "Login" : "Sign up";
      setMsg("");
    };

    const open = () => {
      overlay.style.display = "flex";
      setTimeout(() => $("#qaUsername")?.focus(), 0);
    };

    const close = () => {
      overlay.style.display = "none";
    };

    $("#qaClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    $("#qaTabLogin").addEventListener("click", () => setMode("login"));
    $("#qaTabRegister").addEventListener("click", () => setMode("register"));

    $("#qaSubmit").addEventListener("click", async () => {
      const username = $("#qaUsername").value.trim();
      const password = $("#qaPassword").value;

      if (!username || !password) {
        setMsg("กรุณากรอก username และ password", "bad");
        return;
      }

      setMsg("กำลังทำรายการ...");

      try {
        const endpoint = state.mode === "login" ? API.login : API.register;
        const data = await api(endpoint, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });

        state.token = data.token;
        state.user = data.user;
        localStorage.setItem("token", state.token);

        setLoginUI(true);
        notifyAuthChanged();
        updatePlayerLabel();
        setMsg(state.mode === "login" ? "Login สำเร็จ" : "สมัครสำเร็จและเข้าสู่ระบบแล้ว", "good");
        renderQuizStage();

        setTimeout(close, 250);
      } catch (e) {
        setMsg(e.message || "เกิดข้อผิดพลาด", "bad");
      }
    });

    overlay.__api = { open, close, setMode };
    return overlay;
  }

  function ensureQuizTopic() {
    const content = document.getElementById("content") || document.querySelector("main");
    if (!content) return null;

    let quiz = document.getElementById("quiz");
    if (quiz) return quiz;

    quiz = document.createElement("article");
    quiz.id = "quiz";
    quiz.className = "topic card";
    quiz.innerHTML = `
      <div class="community-header">
        <div>
          <h2>IT Quiz Arena</h2>
          <p class="community-subtitle">ตอบคำถาม IT แล้วบันทึกคะแนนขึ้น Leaderboard</p>
        </div>
      </div>

      <div class="quiz-panel">
        <div class="community-form-row">
          <label class="community-label">ชื่อผู้เล่น</label>
          <div id="playerName">กำลังโหลดชื่อ...</div>
        </div>

        <div class="community-form-row">
          <label class="community-label" for="quizMode">โหมด</label>
          <select id="quizMode" class="community-input">
            <option value="10">10 ข้อ (เร็ว)</option>
            <option value="20">20 ข้อ (มาตรฐาน)</option>
            <option value="30">30 ข้อ (โหด)</option>
          </select>
        </div>

        <div class="quiz-actions">
          <button id="btnStartQuiz" type="button" class="quiz-btn">เริ่มเกม</button>
          <button id="btnSubmitQuiz" type="button" class="quiz-btn ghost">ส่งคำตอบ</button>
          <button id="btnResetQuiz" type="button" class="quiz-btn ghost">รีเซ็ต</button>
        </div>

        <div id="quizResult"></div>
        <div id="quizStage" class="quiz-stage"><div class="muted">กด “เริ่มเกม” เพื่อโหลดคำถามจากเซิร์ฟเวอร์</div></div>

        <h3 style="margin-top:16px">Leaderboard (Top 10)</h3>
        <div id="lbStatus" class="muted">กำลังโหลด...</div>
        <div id="lbBody"></div>
      </div>
    `;

    content.prepend(quiz);
    return quiz;
  }

  function els() {
    return {
      quizArticle: document.getElementById("quiz"),
      playerName: document.getElementById("playerName"),
      quizMode: document.getElementById("quizMode"),
      btnStart: document.getElementById("btnStartQuiz"),
      btnSubmit: document.getElementById("btnSubmitQuiz"),
      btnReset: document.getElementById("btnResetQuiz"),
      quizStage: document.getElementById("quizStage"),
      quizResult: document.getElementById("quizResult"),
      lbStatus: document.getElementById("lbStatus"),
      lbBody: document.getElementById("lbBody"),
    };
  }

  function setText(el, txt) {
    if (el) el.textContent = txt ?? "";
  }

  function updatePlayerLabel() {
    const { playerName } = els();
    if (!playerName) return;
    playerName.textContent = state.user?.username || "Guest";
  }

  function lockQuizUI() {
    const { btnStart, btnSubmit, playerName, quizMode } = els();
    if (btnStart) btnStart.disabled = true;
    if (btnSubmit) btnSubmit.disabled = true;
    if (playerName) playerName.setAttribute("aria-disabled", "true");
    if (quizMode) quizMode.disabled = true;
  }

  function unlockQuizUI() {
    const { btnStart, btnSubmit, quizMode } = els();
    if (btnStart) btnStart.disabled = false;
    if (btnSubmit) btnSubmit.disabled = state.questions.length === 0;
    if (quizMode) quizMode.disabled = false;
  }

  function renderQuizStage() {
    const { quizStage, quizResult } = els();
    if (!quizStage) return;

    if (quizResult) quizResult.innerHTML = "";

    if (!state.questions.length) {
      quizStage.innerHTML = `<div class="muted">กด “เริ่มเกม” เพื่อโหลดคำถามจากเซิร์ฟเวอร์</div>`;
      const { btnSubmit } = els();
      if (btnSubmit) btnSubmit.disabled = true;
      return;
    }

    quizStage.innerHTML = state.questions
      .map(
        (q, index) => `
          <fieldset class="quiz-question" data-question-id="${q.id}">
            <legend><strong>ข้อ ${index + 1}:</strong> ${String(q.question)}</legend>
            ${q.choices
              .map(
                (choice, choiceIndex) => `
                  <label class="quiz-choice">
                    <input type="radio" name="question-${q.id}" value="${choiceIndex}" />
                    <span>${String(choice)}</span>
                  </label>
                `
              )
              .join("")}
          </fieldset>
        `
      )
      .join("");

    const { btnSubmit } = els();
    if (btnSubmit) btnSubmit.disabled = false;
  }

  function collectAnswers() {
    const { quizStage } = els();
    if (!quizStage) return [];

    return state.questions.map((q) => {
      const checked = quizStage.querySelector(`input[name="question-${q.id}"]:checked`);
      return {
        id: q.id,
        choiceIndex: checked ? Number(checked.value) : null,
      };
    }).filter((x) => Number.isInteger(x.choiceIndex));
  }

  async function loadScoreboard() {
    const { lbBody, lbStatus } = els();
    try {
      setText(lbStatus, "กำลังโหลด leaderboard...");
      const data = await api(API.scoreboard(10));
      const rows = data.rows || [];

      if (!lbBody) return;
      if (!rows.length) {
        lbBody.innerHTML = `<div class="muted">ยังไม่มีคะแนน</div>`;
      } else {
        lbBody.innerHTML = rows
          .map(
            (r, i) => `
              <div class="score-row">
                <strong>#${i + 1}</strong>
                <span>${String(r.username)}</span>
                <span>${Number(r.score)}/${Number(r.total)}</span>
                <span>${new Date(r.created_at).toLocaleString("th-TH")}</span>
              </div>
            `
          )
          .join("");
      }
      setText(lbStatus, "พร้อมใช้งาน");
    } catch (e) {
      setText(lbStatus, `โหลด leaderboard ไม่สำเร็จ: ${e.message || "unknown error"}`);
    }
  }

  async function loadQuestions() {
    const ok = await ensureLogin();
    if (!ok) {
      lockQuizUI();
      const modal = ensureModal();
      modal.__api.setMode("login");
      modal.__api.open();
      return;
    }

    const { quizMode, quizStage, quizResult } = els();
    const count = Number(quizMode?.value || 10);

    if (quizResult) quizResult.innerHTML = "";
    if (quizStage) quizStage.innerHTML = `<div class="muted">กำลังโหลดคำถาม...</div>`;

    try {
      const data = await api(API.questions(count), { headers: authHeader() });
      state.questions = data.questions || [];
      renderQuizStage();
      unlockQuizUI();
    } catch (e) {
      if (quizStage) {
        quizStage.innerHTML = `<div class="muted">โหลดคำถามไม่สำเร็จ: ${e.message}</div>`;
      }
    }
  }

  async function submitQuiz() {
    if (state.submitting) return;

    const ok = await ensureLogin();
    if (!ok) {
      const modal = ensureModal();
      modal.__api.setMode("login");
      modal.__api.open();
      return;
    }

    const answers = collectAnswers();
    const { quizResult } = els();

    if (!answers.length) {
      if (quizResult) quizResult.innerHTML = `<div class="quiz-result">กรุณาเลือกคำตอบอย่างน้อย 1 ข้อก่อนส่ง</div>`;
      return;
    }

    state.submitting = true;
    try {
      const data = await api(API.submit, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ answers }),
      });

      const result = data.result;
      if (quizResult) {
        quizResult.innerHTML = `
          <div class="quiz-result">
            ได้คะแนน ${Number(result.score)}/${Number(result.total)} (${Number(result.percent)}%)
          </div>
        `;
      }

      await loadScoreboard();
    } catch (e) {
      if (quizResult) quizResult.innerHTML = `<div class="quiz-result">ส่งคำตอบไม่สำเร็จ: ${e.message}</div>`;
    } finally {
      state.submitting = false;
    }
  }

  function resetQuiz() {
    state.questions = [];
    renderQuizStage();
  }

  window.ITLIB_auth = {
    getToken: () => state.token || "",
    getUser: () => state.user,
    isLoggedIn: () => !!state.token,
    openLogin: () => {
      const modal = ensureModal();
      modal.__api.setMode("login");
      modal.__api.open();
    },
    openRegister: () => {
      const modal = ensureModal();
      modal.__api.setMode("register");
      modal.__api.open();
    },
    logout: doLogout,
    refresh: ensureLogin,
  };

  document.addEventListener("click", async (e) => {
    const quizOpen = e.target.closest('[data-menu="quiz"], [data-target="quiz"]');
    if (!quizOpen) return;

    if (typeof window.ITLIB_showTopic === "function") {
      window.ITLIB_showTopic("quiz");
    }

    const ok = await ensureLogin();
    if (!ok) {
      e.preventDefault();
      lockQuizUI();
      const modal = ensureModal();
      modal.__api.setMode("login");
      modal.__api.open();
    }
  });

  window.addEventListener("DOMContentLoaded", async () => {
    ensureTopAuthUI();
    ensureModal();
    ensureQuizTopic();

    const { loginBtn, logoutBtn } = ensureTopAuthUI();

    if (!loginBtn.__bound) {
      loginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const modal = ensureModal();
        modal.__api.setMode("login");
        modal.__api.open();
      });
      loginBtn.__bound = true;
    }

    if (!logoutBtn.__bound) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        doLogout();
      });
      logoutBtn.__bound = true;
    }

    const loggedIn = await ensureLogin();
    updatePlayerLabel();
    if (!loggedIn) lockQuizUI();
    else unlockQuizUI();

    const { btnStart, btnSubmit, btnReset } = els();

    if (btnStart && !btnStart.__bound) {
      btnStart.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadQuestions();
      });
      btnStart.__bound = true;
    }

    if (btnSubmit && !btnSubmit.__bound) {
      btnSubmit.addEventListener("click", async (e) => {
        e.preventDefault();
        await submitQuiz();
      });
      btnSubmit.__bound = true;
    }

    if (btnReset && !btnReset.__bound) {
      btnReset.addEventListener("click", (e) => {
        e.preventDefault();
        resetQuiz();
      });
      btnReset.__bound = true;
    }

    renderQuizStage();
    await loadScoreboard();
  });
})();