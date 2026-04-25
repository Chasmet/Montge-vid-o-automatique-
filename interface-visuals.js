/*
  Interface visuelle finale
  Ajoute de vraies illustrations dans l’interface sans image externe.
  Les cartes servent de raccourcis : toucher une carte choisit automatiquement le bloc.
*/

(function () {
  const visualMap = [
    {
      keys: ["musique", "rap", "clip", "audio"],
      icon: "🎧",
      colors: ["#ff3b7f", "#7c3aed", "#111827"],
      shape: "music"
    },
    {
      keys: ["voiture", "car", "course", "moto", "racing"],
      icon: "🏎️",
      colors: ["#38bdf8", "#f97316", "#0f172a"],
      shape: "car"
    },
    {
      keys: ["sora", "ia", "science", "fiction", "fantaisie", "futur", "robot"],
      icon: "✨",
      colors: ["#22d3ee", "#8b5cf6", "#020617"],
      shape: "space"
    },
    {
      keys: ["sport", "foot", "football", "match", "psg"],
      icon: "⚽",
      colors: ["#22c55e", "#a3e635", "#0f172a"],
      shape: "ball"
    },
    {
      keys: ["famille", "enfant", "maison", "moi", "portrait"],
      icon: "🏠",
      colors: ["#f59e0b", "#fb7185", "#111827"],
      shape: "family"
    },
    {
      keys: ["horreur", "zombie", "dark", "sombre", "peur"],
      icon: "🌕",
      colors: ["#ef4444", "#7f1d1d", "#020617"],
      shape: "horror"
    },
    {
      keys: ["instagram", "tiktok", "réseau", "reseau", "short", "shorts"],
      icon: "📱",
      colors: ["#ec4899", "#f97316", "#111827"],
      shape: "social"
    },
    {
      keys: ["nature", "loup", "neige", "forêt", "foret", "animal"],
      icon: "🐺",
      colors: ["#14b8a6", "#60a5fa", "#0f172a"],
      shape: "nature"
    },
    {
      keys: ["espace", "planète", "planete", "spatial", "fusée", "fusee", "lune"],
      icon: "🚀",
      colors: ["#38bdf8", "#a855f7", "#020617"],
      shape: "rocket"
    },
    {
      keys: ["documentaire", "doc", "reportage"],
      icon: "🎥",
      colors: ["#64748b", "#06b6d4", "#0f172a"],
      shape: "documentary"
    }
  ];

  function normalize(value) {
    return (value || "")
      .toString()
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(value) {
    return (value || "")
      .toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeId(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "") || "bloc";
  }

  function getBlocks() {
    try {
      if (typeof allMediaBlocks === "function") return allMediaBlocks();
    } catch {}
    return ["Vrac", "Science-fiction / Fantaisie", "Moi", "Documentaire"];
  }

  function getThemeForBlock(blockName) {
    const clean = normalize(blockName);
    const found = visualMap.find((item) => item.keys.some((key) => clean.includes(normalize(key))));
    return found || {
      icon: "🎬",
      colors: ["#38bdf8", "#6366f1", "#0f172a"],
      shape: "default"
    };
  }

  function countItems(blockName) {
    try {
      const type = state?.libraryType || "video";
      const mode = state?.libraryMode || "music";
      const bucket = typeof getBucketForProject === "function"
        ? getBucketForProject(mode, type === "video" ? "video" : "image")
        : `${mode}-${type}`;
      return (state?.cache?.media || []).filter((item) => {
        const itemBlock = (item.block || "Vrac").toString();
        return item.bucket === bucket && itemBlock === blockName;
      }).length;
    } catch {
      return 0;
    }
  }

  function shapeSvg(shape, icon) {
    if (shape === "car") {
      return `
        <path d="M34 76 C44 52 65 42 97 42 L136 42 C158 42 176 56 190 78 L198 92 L28 92 Z" fill="rgba(255,255,255,.22)"/>
        <circle cx="68" cy="96" r="14" fill="rgba(255,255,255,.82)"/>
        <circle cx="156" cy="96" r="14" fill="rgba(255,255,255,.82)"/>
        <path d="M86 47 L108 22 L138 47" stroke="rgba(255,255,255,.42)" stroke-width="7" fill="none"/>
      `;
    }

    if (shape === "music") {
      return `
        <circle cx="85" cy="72" r="48" fill="rgba(255,255,255,.12)"/>
        <path d="M72 102 L72 40 C72 30 81 22 92 22 L110 22 C121 22 130 30 130 40 L130 102" stroke="rgba(255,255,255,.82)" stroke-width="12" fill="none" stroke-linecap="round"/>
        <circle cx="48" cy="82" r="18" fill="rgba(255,255,255,.30)"/>
        <circle cx="154" cy="82" r="18" fill="rgba(255,255,255,.30)"/>
        <path d="M166 32 C184 44 194 58 196 76" stroke="rgba(255,255,255,.40)" stroke-width="6" fill="none" stroke-linecap="round"/>
      `;
    }

    if (shape === "space" || shape === "rocket") {
      return `
        <circle cx="165" cy="33" r="18" fill="rgba(255,255,255,.34)"/>
        <circle cx="54" cy="39" r="5" fill="rgba(255,255,255,.8)"/>
        <circle cx="108" cy="26" r="4" fill="rgba(255,255,255,.7)"/>
        <path d="M116 98 C128 62 148 38 176 20 C174 54 160 82 132 106 Z" fill="rgba(255,255,255,.78)"/>
        <path d="M118 101 L88 118 L105 89 Z" fill="rgba(255,255,255,.22)"/>
        <path d="M136 108 L126 138 L155 116 Z" fill="rgba(255,255,255,.22)"/>
        <path d="M104 116 C91 126 80 136 70 148" stroke="rgba(255,255,255,.42)" stroke-width="7" stroke-linecap="round"/>
      `;
    }

    if (shape === "ball") {
      return `
        <circle cx="120" cy="76" r="50" fill="rgba(255,255,255,.78)"/>
        <path d="M120 36 L145 58 L136 92 L104 92 L95 58 Z" fill="rgba(15,23,42,.75)"/>
        <path d="M73 75 C90 69 102 75 104 92 M167 75 C150 69 138 75 136 92 M102 122 L104 92 M138 122 L136 92" stroke="rgba(15,23,42,.65)" stroke-width="6" fill="none"/>
      `;
    }

    if (shape === "family") {
      return `
        <rect x="56" y="68" width="116" height="70" rx="14" fill="rgba(255,255,255,.22)"/>
        <path d="M46 76 L114 22 L182 76" stroke="rgba(255,255,255,.8)" stroke-width="10" fill="none" stroke-linecap="round"/>
        <circle cx="96" cy="92" r="15" fill="rgba(255,255,255,.75)"/>
        <circle cx="136" cy="92" r="15" fill="rgba(255,255,255,.55)"/>
        <rect x="84" y="112" width="64" height="22" rx="11" fill="rgba(255,255,255,.34)"/>
      `;
    }

    if (shape === "horror") {
      return `
        <circle cx="154" cy="40" r="34" fill="rgba(255,255,255,.72)"/>
        <path d="M44 130 L44 92 C44 70 62 52 84 52 C106 52 124 70 124 92 L124 130 Z" fill="rgba(0,0,0,.44)"/>
        <circle cx="75" cy="88" r="5" fill="rgba(255,255,255,.8)"/>
        <circle cx="94" cy="88" r="5" fill="rgba(255,255,255,.8)"/>
        <path d="M66 118 C84 104 103 112 117 126" stroke="rgba(255,255,255,.32)" stroke-width="7" fill="none"/>
      `;
    }

    if (shape === "social") {
      return `
        <rect x="78" y="24" width="72" height="118" rx="18" fill="rgba(255,255,255,.78)"/>
        <rect x="89" y="39" width="50" height="82" rx="8" fill="rgba(15,23,42,.52)"/>
        <circle cx="114" cy="131" r="5" fill="rgba(15,23,42,.75)"/>
        <circle cx="48" cy="57" r="20" fill="rgba(255,255,255,.24)"/>
        <circle cx="176" cy="95" r="18" fill="rgba(255,255,255,.18)"/>
        <path d="M174 74 L196 52" stroke="rgba(255,255,255,.38)" stroke-width="8" stroke-linecap="round"/>
      `;
    }

    if (shape === "nature") {
      return `
        <path d="M34 138 C70 72 124 112 158 52 C172 88 202 102 210 138 Z" fill="rgba(255,255,255,.24)"/>
        <path d="M74 122 C88 70 120 58 142 84 C162 106 146 137 110 137 C88 137 72 133 74 122 Z" fill="rgba(255,255,255,.42)"/>
        <circle cx="133" cy="82" r="5" fill="rgba(15,23,42,.6)"/>
        <path d="M146 66 L164 44 M115 65 L98 42" stroke="rgba(255,255,255,.44)" stroke-width="7" stroke-linecap="round"/>
      `;
    }

    if (shape === "documentary") {
      return `
        <rect x="50" y="42" width="118" height="76" rx="16" fill="rgba(255,255,255,.65)"/>
        <circle cx="92" cy="80" r="22" fill="rgba(15,23,42,.55)"/>
        <circle cx="92" cy="80" r="10" fill="rgba(255,255,255,.75)"/>
        <path d="M168 66 L204 48 L204 112 L168 94 Z" fill="rgba(255,255,255,.34)"/>
        <rect x="64" y="28" width="22" height="14" rx="5" fill="rgba(255,255,255,.35)"/>
      `;
    }

    return `
      <circle cx="112" cy="80" r="56" fill="rgba(255,255,255,.18)"/>
      <text x="112" y="98" font-size="58" text-anchor="middle">${escapeHtml(icon)}</text>
    `;
  }

  function buildCard(blockName) {
    const theme = getThemeForBlock(blockName);
    const total = countItems(blockName);
    const [c1, c2, c3] = theme.colors;
    const id = safeId(blockName);

    return `
      <button class="iv-card" type="button" data-visual-block="${escapeHtml(blockName)}" style="--iv1:${c1};--iv2:${c2};--iv3:${c3};">
        <svg viewBox="0 0 240 150" role="img" aria-label="${escapeHtml(blockName)}">
          <defs>
            <linearGradient id="iv-g-${id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${c1}"/>
              <stop offset="0.55" stop-color="${c2}"/>
              <stop offset="1" stop-color="${c3}"/>
            </linearGradient>
            <radialGradient id="iv-r-${id}" cx="70%" cy="25%" r="70%">
              <stop offset="0" stop-color="rgba(255,255,255,.55)"/>
              <stop offset="1" stop-color="rgba(255,255,255,0)"/>
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="240" height="150" rx="24" fill="url(#iv-g-${id})"/>
          <rect x="0" y="0" width="240" height="150" rx="24" fill="url(#iv-r-${id})"/>
          <path d="M-20 132 C45 86 87 160 143 94 C178 54 206 60 260 18 L260 170 L-20 170 Z" fill="rgba(255,255,255,.13)"/>
          ${shapeSvg(theme.shape, theme.icon)}
        </svg>
        <span class="iv-card-title">${escapeHtml(blockName)}</span>
        <span class="iv-card-count">${total} fichier${total > 1 ? "s" : ""}</span>
      </button>
    `;
  }

  function injectStyles() {
    if (document.getElementById("interfaceVisualStyles")) return;

    const style = document.createElement("style");
    style.id = "interfaceVisualStyles";
    style.textContent = `
      .interface-visual-panel{
        margin:18px 0;
        padding:18px;
        border:1px solid rgba(148,163,184,.22);
        border-radius:24px;
        background:linear-gradient(180deg, rgba(15,23,42,.96), rgba(2,6,23,.9));
        box-shadow:0 18px 45px rgba(0,0,0,.28);
        position:relative;
        isolation:isolate;
      }
      .interface-visual-head{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:12px;
        margin-bottom:14px;
      }
      .interface-visual-head h3{
        margin:0;
        color:#fff;
        font-size:22px;
        line-height:1.1;
      }
      .interface-visual-head p{
        margin:5px 0 0;
        color:#aab4c5;
        font-size:13px;
      }
      .iv-pill{
        flex:0 0 auto;
        border:1px solid rgba(56,189,248,.35);
        background:rgba(14,165,233,.14);
        color:#bae6fd;
        border-radius:999px;
        padding:8px 10px;
        font-weight:800;
        font-size:12px;
      }
      .interface-visual-grid{
        display:grid;
        grid-template-columns:repeat(2, minmax(0,1fr));
        gap:12px;
      }
      .iv-card{
        min-height:132px;
        border:0;
        border-radius:22px;
        padding:0;
        overflow:hidden;
        background:linear-gradient(135deg,var(--iv1),var(--iv2),var(--iv3));
        position:relative;
        box-shadow:0 12px 28px rgba(0,0,0,.35);
        isolation:isolate;
        text-align:left;
      }
      .iv-card svg{
        width:100%;
        height:100%;
        min-height:132px;
        display:block;
      }
      .iv-card::after{
        content:"";
        position:absolute;
        inset:auto 0 0 0;
        height:62%;
        background:linear-gradient(180deg,transparent,rgba(0,0,0,.66));
        z-index:2;
        pointer-events:none;
      }
      .iv-card-title{
        position:absolute;
        left:13px;
        right:12px;
        bottom:31px;
        z-index:3;
        color:#fff;
        font-weight:950;
        font-size:17px;
        line-height:1.05;
        text-shadow:0 2px 8px rgba(0,0,0,.85);
      }
      .iv-card-count{
        position:absolute;
        left:13px;
        bottom:10px;
        z-index:3;
        color:#dbeafe;
        font-weight:800;
        font-size:12px;
        text-shadow:0 2px 8px rgba(0,0,0,.85);
      }
      .iv-card:active{
        transform:scale(.985);
        filter:brightness(1.1);
      }
      .theme-light .interface-visual-panel{
        background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(239,246,255,.94));
        border-color:rgba(15,23,42,.12);
      }
      .theme-light .interface-visual-head h3{color:#0f172a;}
      .theme-light .interface-visual-head p{color:#475569;}
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    const screen = document.getElementById("screen");
    if (!screen) return;

    const title = document.getElementById("appTitle")?.textContent || "";
    if (!title.toLowerCase().includes("bibliothèque")) return;

    const old = document.getElementById("interfaceVisualPanel");
    if (old) old.remove();

    const resultBoxes = [...document.querySelectorAll(".result-box")];
    const filesBox = resultBoxes.find((box) => box.textContent.includes("Fichiers enregistrés"));
    if (!filesBox) return;

    const blocks = getBlocks();
    const panel = document.createElement("section");
    panel.id = "interfaceVisualPanel";
    panel.className = "interface-visual-panel";
    panel.innerHTML = `
      <div class="interface-visual-head">
        <div>
          <h3>Thématiques visuelles</h3>
          <p>Touche une carte pour choisir rapidement un bloc.</p>
        </div>
        <span class="iv-pill">${blocks.length} blocs</span>
      </div>
      <div class="interface-visual-grid">
        ${blocks.map(buildCard).join("")}
      </div>
    `;

    filesBox.parentElement.insertBefore(panel, filesBox);
  }

  function chooseBlock(block) {
    const upload = document.getElementById("libraryUploadBlock");
    const filter = document.getElementById("libraryBlockFilter");

    if (upload) {
      upload.value = block;
      upload.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (filter) {
      filter.value = block;
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    }

    try {
      showToast(`Bloc choisi : ${block}`);
    } catch {}
  }

  function installClick() {
    if (window.__interfaceVisualClickReady) return;
    window.__interfaceVisualClickReady = true;

    document.addEventListener("click", (event) => {
      const card = event.target.closest("[data-visual-block]");
      if (!card) return;
      chooseBlock(card.dataset.visualBlock || "Vrac");
    });
  }

  function boot() {
    injectStyles();
    injectPanel();
    installClick();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(boot, 120);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pageshow", boot);
  setTimeout(boot, 300);
  setTimeout(boot, 1000);
})();
