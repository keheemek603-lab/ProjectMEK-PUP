// carousel.js — with captions (วางทับทั้งไฟล์)
(() => {
  function parseImages(s) {
    return String(s || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
  }

  function parseCaptions(s) {
    // captions ใช้ | คั่น
    return String(s || "")
      .split("|")
      .map(x => x.trim());
  }

  function initCarousel(root) {
    const images = parseImages(root.dataset.images);
    const captions = parseCaptions(root.dataset.captions);

    if (images.length <= 0) return;

    const img = root.querySelector(".img-main");
    const prevBtn = root.querySelector(".img-nav.prev");
    const nextBtn = root.querySelector(".img-nav.next");
    const counter = root.querySelector(".img-counter");
    const dotsWrap = root.querySelector(".img-dots");
    const captionEl = root.querySelector(".img-caption");

    let idx = 0;

    function renderDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = "";
      images.forEach((_, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "img-dot" + (i === idx ? " active" : "");
        b.setAttribute("aria-label", `ไปภาพที่ ${i + 1}`);
        b.addEventListener("click", () => {
          idx = i;
          render();
        });
        dotsWrap.appendChild(b);
      });
    }

    function render() {
      if (img) {
        img.src = images[idx];
        img.alt = captions[idx] ? captions[idx] : `CPU photo ${idx + 1}`;
      }

      if (counter) counter.textContent = `${idx + 1} / ${images.length}`;

      // dots active
      if (dotsWrap) {
        const dots = dotsWrap.querySelectorAll(".img-dot");
        dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      }

      // ✅ caption แสดงชื่อที่มึงพิมพ์เอง
      if (captionEl) {
        captionEl.textContent = captions[idx] || `ภาพที่ ${idx + 1}`;
      }
    }

    function next() {
      idx = (idx + 1) % images.length;
      render();
    }

    function prev() {
      idx = (idx - 1 + images.length) % images.length;
      render();
    }

    prevBtn?.addEventListener("click", prev);
    nextBtn?.addEventListener("click", next);

    // keyboard
    root.tabIndex = 0;
    root.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    });

    renderDots();
    render();
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".img-carousel").forEach(initCarousel);
  });
})();