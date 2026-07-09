(() => {
  const PANEL_SELECTOR = "#interfaceVisualPanel";
  const GRID_SELECTOR = "#interfaceVisualPanel .interface-visual-grid";
  const PILL_SELECTOR = "#interfaceVisualPanel .iv-pill";

  function safeText(value) {
    return String(value || "").trim();
  }

  function normalize(value) {
    return safeText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(value) {
    return safeText(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
      const clean = safeText(value) || "Vrac";
      const key = normalize(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result;
  }

  function currentBucket() {
    try {
      const mode = state?.libraryMode || "music";
      const type = state?.libraryType === "image" ? "image" : "video";
      return typeof getBucketForProject === "function" ? getBucketForProject(mode, type) : `${mode}-${type}`;
    } catch {
      return "music-video";
    }
  }

  function liveImportedBlocks() {
    try {
      const bucket = currentBucket();
      const profile = state?.profile;
      const blocks = (state?.cache?.media || [])
        .filter(item => !profile || item.owner === profile)
        .filter(item => !bucket || item.bucket === bucket)
        .map(item => item.block || "Vrac")
        .filter(Boolean);

      const draftBlocks = [
        state?.temp?.musicDraft?.primaryBlock,
        ...(state?.temp?.musicDraft?.allowedBlocks || []),
        state?.temp?.speechDraft?.primaryBlock,
        ...(state?.temp?.speechDraft?.allowedBlocks || [])
      ];

      return unique([...blocks, ...draftBlocks]);
    } catch {
      return [];
    }
  }

  function defaultBlocks() {
    try {
      if (Array.isArray(DEFAULT_MEDIA_BLOCKS)) return DEFAULT_MEDIA_BLOCKS;
    } catch {}
    return ["Animé / Manga", "Pixar / Cartoon", "Vrac", "Horreur", "Science-fiction / Fantaisie", "Moi", "Documentaire"];
  }

  function allBlocksWithImported() {
    let base = [];
    try {
      if (typeof allMediaBlocks === "function") base = allMediaBlocks();
    } catch {}

    if (!base.length) base = defaultBlocks();
    return unique([...base, ...(state?.customBlocks || []), ...liveImportedBlocks()]);
  }

  function syncCustomBlocks() {
    try {
      if (!state) return;
      const defaults = new Set(defaultBlocks().map(normalize));
      const current = Array.isArray(state.customBlocks) ? state.customBlocks : [];
      const merged = unique([...current, ...liveImportedBlocks().filter(block => !defaults.has(normalize(block)))]);
      if (merged.length !== current.length || merged.some((block, index) => block !== current[index])) {
        state.customBlocks = merged;
        if (typeof saveCustomBlocks === "function") saveCustomBlocks().catch?.(() => {});
      }
    } catch {}
  }

  function countBlock(block) {
    try {
      const bucket = currentBucket();
      const profile = state?.profile;
      const key = normalize(block);
      return (state?.cache?.media || [])
        .filter(item => !profile || item.owner === profile)
        .filter(item => item.bucket === bucket)
        .filter(item => normalize(item.block || "Vrac") === key)
        .length;
    } catch {
      return 0;
    }
  }

  function cardHtml(block) {
    const total = countBlock(block);
    const key = normalize(block);
    const isGrok = key.includes("grok");
    const gradient = isGrok
      ? "--iv1:#10b981;--iv2:#2563eb;--iv3:#020617;"
      : "--iv1:#38bdf8;--iv2:#6366f1;--iv3:#0f172a;";
    const icon = isGrok ? "🤖" : "🎬";

    return `
      <button class="iv-card iv-imported-card" type="button" data-visual-block="${escapeHtml(block)}" style="${gradient}">
        <svg viewBox="0 0 240 150" role="img" aria-label="${escapeHtml(block)}">
          <defs>
            <linearGradient id="iv-imported-${Math.random().toString(36).slice(2)}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="var(--iv1)"/>
              <stop offset="0.55" stop-color="var(--iv2)"/>
              <stop offset="1" stop-color="var(--iv3)"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="240" height="150" rx="24" fill="var(--iv2)"/>
          <circle cx="112" cy="72" r="52" fill="rgba(255,255,255,.16)"/>
          <text x="112" y="94" font-size="58" text-anchor="middle">${icon}</text>
          <path d="M-20 132 C45 86 87 160 143 94 C178 54 206 60 260 18 L260 170 L-20 170 Z" fill="rgba(255,255,255,.13)"/>
        </svg>
        <span class="iv-card-title">${escapeHtml(block)}</span>
        <span class="iv-card-count">${total} fichier${total > 1 ? "s" : ""}</span>
      </button>
    `;
  }

  function addOption(select, value, label = value) {
    if (!select || !value) return;
    const exists = [...select.options].some(option => normalize(option.value) === normalize(value));
    if (!exists) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function addBlockToAllSelects(block) {
    const selectors = [
      "#libraryUploadBlock",
      "#libraryBlockFilter",
      "#musicPrimaryBlock",
      "#speechPrimaryBlock",
      "select[name='primaryBlock']",
      "select[name='block']"
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(select => addOption(select, block));
    });
  }

  function chooseImportedBlock(block) {
    const clean = safeText(block) || "Vrac";
    syncCustomBlocks();
    addBlockToAllSelects(clean);

    const upload = document.getElementById("libraryUploadBlock");
    const filter = document.getElementById("libraryBlockFilter");

    if (upload) {
      addOption(upload, clean);
      upload.value = clean;
      upload.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (filter) {
      addOption(filter, clean);
      filter.value = clean;
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    }

    try {
      if (state?.temp?.musicDraft) {
        state.temp.musicDraft.mediaSourceMode = "single";
        state.temp.musicDraft.primaryBlock = clean;
        state.temp.musicDraft.allowedBlocks = [clean];
        if (typeof saveMusicDraft === "function") saveMusicDraft().catch?.(() => {});
      }

      if (state?.temp?.speechDraft) {
        state.temp.speechDraft.mediaSourceMode = "single";
        state.temp.speechDraft.primaryBlock = clean;
        state.temp.speechDraft.allowedBlocks = [clean];
        if (typeof saveSpeechDraft === "function") saveSpeechDraft().catch?.(() => {});
      }
    } catch {}

    try { showToast(`Bloc choisi : ${clean}`); } catch {}
  }

  function injectImportedCards() {
    syncCustomBlocks();

    const panel = document.querySelector(PANEL_SELECTOR);
    const grid = document.querySelector(GRID_SELECTOR);
    if (!panel || !grid) return;

    const blocks = allBlocksWithImported();
    const existing = new Set([...grid.querySelectorAll("[data-visual-block]")].map(card => normalize(card.dataset.visualBlock)));

    for (const block of blocks) {
      if (existing.has(normalize(block))) continue;
      grid.insertAdjacentHTML("beforeend", cardHtml(block));
      existing.add(normalize(block));
    }

    const pill = document.querySelector(PILL_SELECTOR);
    if (pill) pill.textContent = `${blocks.length} blocs`;
  }

  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-visual-block]");
    if (!card) return;
    chooseImportedBlock(card.dataset.visualBlock || "Vrac");
  }, true);

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(injectImportedCards, 120);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pageshow", injectImportedCards);
  window.addEventListener("android-shared-files-ready", injectImportedCards);
  setInterval(injectImportedCards, 1200);
  setTimeout(injectImportedCards, 300);
  setTimeout(injectImportedCards, 1200);
})();
