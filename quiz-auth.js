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

  function authHeader() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }

  const API_BASE = "https://project-mek-pup.onrender.com";

function toApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

async function api(path, opts = {}) {
  const res = await fetch(toApiUrl(path), {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
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
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-flex";
    } else {
      statusEl.textContent = "Guest";
      loginBtn.style.display = "inline-flex";
      logoutBtn.style.display = "none";
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
    localStorage.removeItem("token");
    setLoginUI(false);
    notifyAuthChanged();
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
        setMsg(state.mode === "login" ? "Login สำเร็จ" : "สมัครสำเร็จและเข้าสู่ระบบแล้ว", "good");

        setTimeout(() => {
          close();
        }, 250);
      } catch (e) {
        setMsg(e.message || "เกิดข้อผิดพลาด", "bad");
      }
    });

    overlay.__api = { open, close, setMode };
    return overlay;
  }

  function showQuizTopic() {
    if (typeof window.ITLIB_showTopic === "function") {
      window.ITLIB_showTopic("quiz");
      return;
    }
    const quiz = document.getElementById("quiz");
    if (quiz) quiz.style.display = "block";
  }

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

  function lockQuizUI() {
    const { btnStart, playerName, quizMode } = els();
    if (btnStart) btnStart.disabled = true;
    if (playerName) playerName.disabled = true;
    if (quizMode) quizMode.disabled = true;
  }

  function unlockQuizUI() {
    const { btnStart, playerName, quizMode } = els();
    if (btnStart) btnStart.disabled = false;
    if (playerName) playerName.disabled = false;
    if (quizMode) quizMode.disabled = false;
  }

  async function loadScoreboard() {
    const { lbBody, lbStatus } = els();
    try {
      setText(lbStatus, "กำลังโหลด scoreboard...");
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
                <strong>#${i + 1}</strong> ${String(r.username)} — ${Number(r.score)}/${Number(r.total)}
              </div>
            `
          )
          .join("");
      }
      setText(lbStatus, "พร้อมใช้งาน");
    } catch {
      setText(lbStatus, "โหลด scoreboard ไม่สำเร็จ");
    }
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
    if (!loggedIn) lockQuizUI();
    else unlockQuizUI();

    const { btnStart, btnReset } = els();

    if (btnStart && !btnStart.__bound) {
      btnStart.addEventListener("click", async (e) => {
        e.preventDefault();
        const ok = await ensureLogin();
        if (!ok) {
          const modal = ensureModal();
          modal.__api.setMode("login");
          modal.__api.open();
          return;
        }

        const { quizMode, quizStage } = els();
        const count = Number(quizMode?.value || 5);
        const data = await api(API.questions(count), { headers: authHeader() });

        state.questions = data.questions || [];
        if (quizStage) {
          quizStage.innerHTML = `<div class="muted">โหลดข้อสอบแล้ว ${state.questions.length} ข้อ</div>`;
        }
      });
      btnStart.__bound = true;
    }

    if (btnReset && !btnReset.__bound) {
      btnReset.addEventListener("click", (e) => {
        e.preventDefault();
        const { quizStage } = els();
        state.questions = [];
        if (quizStage) {
          quizStage.innerHTML = `<div class="muted">รีเซ็ตแล้ว</div>`;
        }
      });
      btnReset.__bound = true;
    }

    await loadScoreboard();
  });
})();