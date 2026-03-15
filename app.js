(() => {
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);

  const content = document.getElementById("content");
  if (!content) return;

  const topics = $$(".topic", content);
  const placeholder = $(".placeholder", content);

  function hideAllTopics() {
    topics.forEach((t) => (t.style.display = "none"));
  }

  function showTopic(id) {
    const target = document.getElementById(id);
    if (!target) return;
    if (placeholder) placeholder.style.display = "none";
    hideAllTopics();
    target.style.display = "block";
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.ITLIB_showTopic = showTopic;
  hideAllTopics();
  if (placeholder) placeholder.style.display = "block";

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.matches('a[data-menu="quiz"], a[data-target="quiz"]')) return;

    const targetId = a.getAttribute("data-target");
    if (targetId) {
      e.preventDefault();
      showTopic(targetId);
      if (targetId === "community-feed") window.ITLIB_community?.loadFeed?.();
      if (targetId === "community-mine") window.ITLIB_community?.loadMine?.();
      if (targetId === "community-profile") window.ITLIB_community?.loadMyProfile?.();
      return;
    }

    const menu = a.getAttribute("data-menu");
    if (!menu || menu === "quiz") return;

    const box = a.closest(".box");
    const firstSub = box?.querySelector(".flyout a.sub[data-target]");
    const firstId = firstSub?.getAttribute("data-target");

    if (firstId) {
      e.preventDefault();
      showTopic(firstId);
      if (firstId === "community-feed") window.ITLIB_community?.loadFeed?.();
      if (firstId === "community-mine") window.ITLIB_community?.loadMine?.();
      if (firstId === "community-profile") window.ITLIB_community?.loadMyProfile?.();
    }
  });
})();

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const showTopic = window.ITLIB_showTopic;
  if (!showTopic) return;

  const state = {
    me: null,
    currentProfile: null,
    commentsOpen: new Set(),
    commentCache: new Map(),
    editingPostId: null,
  };

  const els = {
    feedList: document.getElementById("communityFeedList"),
    mineList: document.getElementById("communityMineList"),
    profileCard: document.getElementById("communityProfileCard"),
    profilePosts: document.getElementById("communityProfilePosts"),
    form: document.getElementById("communityPostForm"),
    formTitle: document.getElementById("communityPostTitle"),
    formContent: document.getElementById("communityPostContent"),
    formImage: document.getElementById("communityPostImage"),
    formStatus: document.getElementById("communityFormStatus"),
    formId: document.getElementById("communityPostId"),
    formSubmit: document.getElementById("communitySubmitBtn"),
    formCancel: document.getElementById("communityCancelEdit"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function nl2br(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function getToken() {
    return window.ITLIB_auth?.getToken?.() || localStorage.getItem("token") || "";
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getToken();

    if (options.auth && token) headers.Authorization = `Bearer ${token}`;
    if (options.auth && !token) throw new Error("LOGIN_REQUIRED");

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function openLoginModal() {
    if (window.ITLIB_auth?.openLogin) {
      window.ITLIB_auth.openLogin();
      return;
    }
    const loginTab = document.getElementById("qaTabLogin");
    const overlay = document.getElementById("qaOverlay");
    loginTab?.click();
    if (overlay) overlay.style.display = "flex";
  }

  function setFormStatus(text, type = "") {
    if (!els.formStatus) return;
    els.formStatus.textContent = text || "";
    els.formStatus.classList.remove("ok", "error");
    if (type === "ok") els.formStatus.classList.add("ok");
    if (type === "error") els.formStatus.classList.add("error");
  }

  async function requireLogin(message = "กรุณา Sign in ก่อนทำรายการนี้") {
    try {
      if (window.ITLIB_auth?.refresh) {
        const ok = await window.ITLIB_auth.refresh();
        if (ok) {
          state.me = window.ITLIB_auth.getUser?.() || state.me;
          return true;
        }
      }
      const me = await api("/api/me", { auth: true });
      state.me = me.user;
      return true;
    } catch {
      setFormStatus(message, "error");
      openLoginModal();
      return false;
    }
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString("th-TH");
    } catch {
      return String(value);
    }
  }

  function resetPostForm() {
    state.editingPostId = null;
    if (els.form) els.form.reset();
    if (els.formId) els.formId.value = "";
    if (els.formSubmit) els.formSubmit.textContent = "โพสต์ข้อความ";
    if (els.formCancel) els.formCancel.hidden = true;
    setFormStatus("พร้อมสร้างโพสต์ใหม่");
  }

  function fillPostForm(post) {
    state.editingPostId = post.id;
    if (els.formId) els.formId.value = String(post.id);
    if (els.formTitle) els.formTitle.value = post.title || "";
    if (els.formContent) els.formContent.value = post.content || "";
    if (els.formImage) els.formImage.value = post.image_url || "";
    if (els.formSubmit) els.formSubmit.textContent = "บันทึกการแก้ไข";
    if (els.formCancel) els.formCancel.hidden = false;
    setFormStatus(`กำลังแก้ไขโพสต์ #${post.id}`);
    showTopic("community-create");
  }

  function renderComment(comment) {
    return `
      <div class="comment-item" data-comment-id="${comment.id}">
        <div class="comment-head">
          <strong>${escapeHtml(comment.username)}</strong>
          <span>${escapeHtml(formatDate(comment.created_at))}</span>
        </div>
        <div class="comment-body">${nl2br(comment.content)}</div>
        ${comment.can_delete ? `<div class="comment-actions"><button type="button" class="community-btn small ghost" data-delete-comment="${comment.id}">ลบคอมเมนต์</button></div>` : ""}
      </div>
    `;
  }

  function renderCommentsPanel(postId) {
    const comments = state.commentCache.get(postId) || [];
    return `
      <section class="comments-panel" id="comments-panel-${postId}" ${state.commentsOpen.has(postId) ? "" : "hidden"}>
        <div class="comments-list" id="comments-list-${postId}">
          ${comments.length ? comments.map(renderComment).join("") : '<div class="comment-empty">ยังไม่มีคอมเมนต์</div>'}
        </div>
        <form class="comment-form" data-comment-form="${postId}">
          <textarea class="comment-input" name="content" rows="3" placeholder="เขียนคอมเมนต์..."></textarea>
          <div class="comment-form-actions">
            <button type="submit" class="community-btn small">ส่งคอมเมนต์</button>
          </div>
        </form>
      </section>
    `;
  }

  function renderPostCard(post) {
    const imageHtml = post.image_url
      ? `<div class="post-image-wrap"><img class="post-image" src="${escapeHtml(post.image_url)}" alt="post image" loading="lazy"></div>`
      : "";

    const ownerActions = post.is_owner
      ? `
        <div class="post-owner-actions">
          <button type="button" class="community-btn small ghost" data-edit-post="${post.id}">แก้ไข</button>
          <button type="button" class="community-btn small ghost danger" data-delete-post="${post.id}">ลบ</button>
        </div>
      `
      : "";

    return `
      <article class="post-card" data-post-id="${post.id}">
        <div class="post-head-row">
          <div class="post-top">
            <div class="post-avatar">${escapeHtml((post.author_username || "U").slice(0, 1).toUpperCase())}</div>
            <div>
              <div class="post-author">${escapeHtml(post.author_username)}</div>
              <div class="post-meta">${escapeHtml(formatDate(post.created_at))}</div>
            </div>
          </div>
          ${ownerActions}
        </div>
        <h3 class="post-title">${escapeHtml(post.title)}</h3>
        <div class="post-content">${nl2br(post.content)}</div>
        ${imageHtml}
        <div class="post-stats">
          <span>👍 ${Number(post.likes_count || 0)} Like</span>
          <span>💬 ${Number(post.comments_count || 0)} Comment</span>
        </div>
        <div class="post-actions">
          <button type="button" class="community-btn small ${post.liked_by_me ? "" : "ghost"}" data-like-post="${post.id}">${post.liked_by_me ? "Unlike" : "Like"}</button>
          <button type="button" class="community-btn small ghost" data-toggle-comments="${post.id}">Comment</button>
          <button type="button" class="community-btn small ghost" data-view-profile="${escapeHtml(post.author_username)}">Profile</button>
        </div>
        ${renderCommentsPanel(post.id)}
      </article>
    `;
  }

  async function loadFeed() {
    if (!els.feedList) return;
    els.feedList.innerHTML = '<div class="muted">กำลังโหลดโพสต์...</div>';
    try {
      const data = await api("/api/posts?limit=30");
      const posts = data.posts || [];
      els.feedList.innerHTML = posts.length
        ? posts.map(renderPostCard).join("")
        : '<div class="community-empty"><div class="community-empty-icon">📰</div><h3>ยังไม่มีโพสต์</h3><p class="muted">เป็นคนแรกที่แชร์ความรู้ใน Community ได้เลย</p></div>';
    } catch (err) {
      els.feedList.innerHTML = `<div class="muted">โหลดโพสต์ไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadMine() {
    if (!els.mineList) return;
    const ok = await requireLogin("กรุณา Sign in ก่อนดูโพสต์ของฉัน");
    if (!ok) return;

    els.mineList.innerHTML = '<div class="muted">กำลังโหลดโพสต์ของฉัน...</div>';
    try {
      const data = await api("/api/posts?mine=1&limit=50", { auth: true });
      const posts = data.posts || [];
      els.mineList.innerHTML = posts.length
        ? posts.map(renderPostCard).join("")
        : '<div class="community-empty"><div class="community-empty-icon">📝</div><h3>ยังไม่มีโพสต์ของคุณ</h3><p class="muted">กดปุ่มสร้างโพสต์ใหม่เพื่อเริ่มต้น</p></div>';
    } catch (err) {
      els.mineList.innerHTML = `<div class="muted">โหลดโพสต์ของฉันไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadComments(postId) {
    try {
      const data = await api(`/api/posts/${postId}/comments`);
      state.commentCache.set(postId, data.comments || []);
      const list = document.getElementById(`comments-list-${postId}`);
      if (list) {
        list.innerHTML = data.comments?.length ? data.comments.map(renderComment).join("") : '<div class="comment-empty">ยังไม่มีคอมเมนต์</div>';
      }
    } catch (err) {
      const list = document.getElementById(`comments-list-${postId}`);
      if (list) list.innerHTML = `<div class="comment-empty">โหลดคอมเมนต์ไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function toggleComments(postId) {
    const panel = document.getElementById(`comments-panel-${postId}`);
    if (!panel) return;
    const isHidden = panel.hasAttribute("hidden");
    if (isHidden) {
      panel.removeAttribute("hidden");
      state.commentsOpen.add(postId);
      await loadComments(postId);
    } else {
      panel.setAttribute("hidden", "hidden");
      state.commentsOpen.delete(postId);
    }
  }

  async function submitComment(postId, form) {
    const ok = await requireLogin("กรุณา Sign in ก่อนคอมเมนต์");
    if (!ok) return;
    const textarea = form?.querySelector("textarea[name='content']");
    const content = textarea?.value?.trim() || "";
    if (!content) return;

    try {
      await api(`/api/posts/${postId}/comments`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ content }),
      });
      textarea.value = "";
      await loadComments(postId);
      await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleLike(postId) {
    const ok = await requireLogin("กรุณา Sign in ก่อนกด Like");
    if (!ok) return;
    try {
      await api(`/api/posts/${postId}/like`, { method: "POST", auth: true });
      await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteComment(commentId) {
    const ok = await requireLogin("กรุณา Sign in ก่อนลบคอมเมนต์");
    if (!ok) return;
    if (!confirm("ลบคอมเมนต์นี้ใช่ไหม?")) return;
    try {
      const data = await api(`/api/comments/${commentId}`, { method: "DELETE", auth: true });
      if (data.post_id) await loadComments(Number(data.post_id));
      await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
    } catch (err) {
      alert(err.message);
    }
  }

  async function deletePost(postId) {
    const ok = await requireLogin("กรุณา Sign in ก่อนลบโพสต์");
    if (!ok) return;
    if (!confirm("ลบโพสต์นี้ใช่ไหม?")) return;
    try {
      await api(`/api/posts/${postId}`, { method: "DELETE", auth: true });
      if (state.editingPostId === postId) resetPostForm();
      await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
      setFormStatus("ลบโพสต์แล้ว", "ok");
    } catch (err) {
      alert(err.message);
    }
  }

  async function beginEdit(postId) {
    const ok = await requireLogin("กรุณา Sign in ก่อนแก้ไขโพสต์");
    if (!ok) return;
    try {
      const mine = await api("/api/posts?mine=1&limit=100", { auth: true });
      const post = (mine.posts || []).find((p) => Number(p.id) === Number(postId));
      if (!post) {
        alert("ไม่พบโพสต์ของคุณ");
        return;
      }
      fillPostForm(post);
    } catch (err) {
      alert(err.message);
    }
  }

  async function submitPostForm(e) {
    e.preventDefault();
    const ok = await requireLogin("กรุณา Sign in ก่อนโพสต์ข้อความ");
    if (!ok) return;

    const title = els.formTitle?.value?.trim() || "";
    const content = els.formContent?.value?.trim() || "";
    const image_url = els.formImage?.value?.trim() || "";
    const postId = Number(els.formId?.value || 0);

    if (!title || !content) {
      setFormStatus("กรุณากรอกหัวข้อโพสต์และเนื้อหาโพสต์ก่อน", "error");
      return;
    }

    try {
      if (postId) {
        await api(`/api/posts/${postId}`, {
          method: "PUT",
          auth: true,
          body: JSON.stringify({ title, content, image_url }),
        });
        setFormStatus("บันทึกการแก้ไขแล้ว", "ok");
      } else {
        await api("/api/posts", {
          method: "POST",
          auth: true,
          body: JSON.stringify({ title, content, image_url }),
        });
        setFormStatus("โพสต์ข้อความสำเร็จ", "ok");
      }

      resetPostForm();
      showTopic("community-feed");
      await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
    } catch (err) {
      setFormStatus(`เกิดข้อผิดพลาด: ${err.message}`, "error");
    }
  }

  async function loadProfile(username) {
    if (!els.profileCard || !els.profilePosts) return;
    if (username === "me") {
      const ok = await requireLogin("กรุณา Sign in ก่อนดูโปรไฟล์ของคุณ");
      if (!ok) return;
    }

    els.profileCard.innerHTML = '<div class="muted">กำลังโหลดข้อมูลโปรไฟล์...</div>';
    els.profilePosts.innerHTML = '<div class="muted">กำลังโหลดโพสต์ของโปรไฟล์...</div>';

    try {
      const profileData = username === "me"
        ? await api("/api/profile/me", { auth: true })
        : await api(`/api/profile/${encodeURIComponent(username)}`);
      const profile = profileData.profile;
      state.currentProfile = profile.username;

      els.profileCard.innerHTML = `
        <div class="profile-card-inner">
          <div class="profile-avatar">${escapeHtml((profile.username || "U").slice(0, 1).toUpperCase())}</div>
          <div>
            <h3 class="profile-name">${escapeHtml(profile.username)}</h3>
            <div class="profile-meta">สมาชิกตั้งแต่ ${escapeHtml(formatDate(profile.created_at))}</div>
            <div class="profile-stats">
              <span>โพสต์ ${Number(profile.posts_count || 0)}</span>
              <span>คอมเมนต์ ${Number(profile.comments_count || 0)}</span>
              <span>Like ที่ได้รับ ${Number(profile.likes_received || 0)}</span>
            </div>
          </div>
        </div>
      `;

      const posts = profileData.posts || [];
      els.profilePosts.innerHTML = posts.length
        ? posts.map(renderPostCard).join("")
        : '<div class="community-empty"><div class="community-empty-icon">👤</div><h3>ผู้ใช้นี้ยังไม่มีโพสต์</h3></div>';

      showTopic("community-profile");
    } catch (err) {
      els.profileCard.innerHTML = `<div class="muted">โหลดโปรไฟล์ไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
      els.profilePosts.innerHTML = "";
    }
  }

  async function loadMyProfile() {
    await loadProfile("me");
  }

  async function loadMineIfVisible() {
    const mine = document.getElementById("community-mine");
    if (mine && mine.style.display !== "none") await loadMine();
  }

  async function refreshProfileIfVisible() {
    const profile = document.getElementById("community-profile");
    if (profile && profile.style.display !== "none" && state.currentProfile) {
      await loadProfile(state.currentProfile === state.me?.username ? "me" : state.currentProfile);
    }
  }

  document.addEventListener("click", async (e) => {
    const targetBtn = e.target.closest("button[data-target]");
    if (targetBtn) {
      const targetId = targetBtn.getAttribute("data-target");
      const mustLogin = targetBtn.getAttribute("data-require-auth") === "true";

      if (mustLogin) {
        const ok = await requireLogin("กรุณา Sign in ก่อนเข้าใช้งานส่วนนี้");
        if (!ok) return;
      }

      if (targetId) {
        e.preventDefault();
        showTopic(targetId);
        if (targetId === "community-feed") await loadFeed();
        if (targetId === "community-mine") await loadMine();
        if (targetId === "community-profile") await loadMyProfile();
      }
      return;
    }

    const likeBtn = e.target.closest("[data-like-post]");
    if (likeBtn) {
      e.preventDefault();
      await toggleLike(Number(likeBtn.getAttribute("data-like-post")));
      return;
    }

    const commentsBtn = e.target.closest("[data-toggle-comments]");
    if (commentsBtn) {
      e.preventDefault();
      await toggleComments(Number(commentsBtn.getAttribute("data-toggle-comments")));
      return;
    }

    const profileBtn = e.target.closest("[data-view-profile]");
    if (profileBtn) {
      e.preventDefault();
      await loadProfile(profileBtn.getAttribute("data-view-profile"));
      return;
    }

    const deleteCommentBtn = e.target.closest("[data-delete-comment]");
    if (deleteCommentBtn) {
      e.preventDefault();
      await deleteComment(Number(deleteCommentBtn.getAttribute("data-delete-comment")));
      return;
    }

    const editBtn = e.target.closest("[data-edit-post]");
    if (editBtn) {
      e.preventDefault();
      await beginEdit(Number(editBtn.getAttribute("data-edit-post")));
      return;
    }

    const deleteBtn = e.target.closest("[data-delete-post]");
    if (deleteBtn) {
      e.preventDefault();
      await deletePost(Number(deleteBtn.getAttribute("data-delete-post")));
      return;
    }
  });

  document.addEventListener("submit", async (e) => {
    const commentForm = e.target.closest("form[data-comment-form]");
    if (commentForm) {
      e.preventDefault();
      await submitComment(Number(commentForm.getAttribute("data-comment-form")), commentForm);
    }
  });

  els.form?.addEventListener("submit", submitPostForm);
  els.formCancel?.addEventListener("click", (e) => {
    e.preventDefault();
    resetPostForm();
  });

  window.addEventListener("itlib-auth-changed", async () => {
    state.me = window.ITLIB_auth?.getUser?.() || null;
    await Promise.all([loadFeed(), loadMineIfVisible(), refreshProfileIfVisible()]);
  });

  resetPostForm();

  window.ITLIB_community = {
    loadFeed,
    loadMine,
    loadMyProfile,
  };
})();