// app.js (IT Library navigation/router) — วางทับทั้งไฟล์

(() => {
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);

  const content = document.getElementById("content");
  if (!content) return;

  // ทุกบทความอยู่ใน <article class="topic ..."> และมี id เช่น id="hardware", id="windows" ฯลฯ
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

    // scroll ให้เห็นหัวข้อ (ไม่บังคับก็ได้)
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  window.ITLIB_showTopic = showTopic;
  // เริ่มต้น: ซ่อนทุกบทความก่อน (ยกเว้น placeholder)
  hideAllTopics();
  if (placeholder) placeholder.style.display = "block";

  // คลิกหัวข้อย่อยใน flyout: <a class="sub" data-target="hardware">...</a>
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;

    
    if (a.matches('a[data-menu="quiz"], a[data-target="quiz"]')) return;

    const targetId = a.getAttribute("data-target");
    if (!targetId) return;

    e.preventDefault();
    showTopic(targetId);
  });

  // (เสริม) ถ้าอยากให้คลิกเมนูหลักแล้วโชว์หัวข้อแรกของหมวดนั้น:
  // <a class="main" data-menu="hardware">...</a>
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.main[data-menu]");
    if (!a) return;

    // ปล่อย quiz ให้ quiz-auth.js
    if (a.getAttribute("data-menu") === "quiz") return;

    const menu = a.getAttribute("data-menu");
    if (!menu) return;

    // หา sub แรกที่อยู่ใน flyout ของหมวดนั้น
    const box = a.closest(".box");
    const firstSub = box?.querySelector(".flyout a.sub[data-target]");
    const firstId = firstSub?.getAttribute("data-target");

    if (firstId) {
      e.preventDefault();
      showTopic(firstId);
    }
  });
})();

