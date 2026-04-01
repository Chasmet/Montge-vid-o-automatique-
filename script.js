const APP_NAME = "Studio vidéo IA";
const DB_NAME = "montage-ia-mobile-v5";
const DB_VERSION = 1;
const ADMIN_PASSWORD_DEFAULT = "admin123";

const BACKEND_BASE_URL = "https://montge-vid-o-automatique.onrender.com";
const GEMINI_BACKEND_URL = "https://montge-vid-o-automatique-1.onrender.com";

const DEFAULT_MEDIA_BLOCKS = [
  "Animé / Manga",
  "Pixar / Cartoon",
  "Vrac",
  "Horreur",
  "Science-fiction / Fantaisie",
  "Moi",
  "Documentaire"
];

const DURATION_OPTIONS = ["10", "15", "20", "25", "30"];

const VOICE_FAMILY_LABELS = {
  naturel: "Naturel",
  emotion: "Émotion",
  dynamique: "Dynamique",
  special: "Spécial"
};

const VOICE_STYLE_GROUPS = {
  naturel: [
    { id: "masculin-naturel", label: "Masculin naturel" },
    { id: "feminin-naturel", label: "Féminin naturel" },
    { id: "masculin-mature", label: "Masculin mature" },
    { id: "feminin-mature", label: "Féminin mature" }
  ],
  emotion: [
    { id: "masculin-emotion", label: "Masculin émotion" },
    { id: "feminin-emotion", label: "Féminin émotion" },
    { id: "voix-douce", label: "Voix douce" },
    { id: "voix-sombre", label: "Voix sombre" }
  ],
  dynamique: [
    { id: "masculin-energetique", label: "Masculin énergique" },
    { id: "feminin-dynamique", label: "Féminin dynamique" },
    { id: "voix-punchy", label: "Voix punchy" },
    { id: "voix-annonce", label: "Voix annonce" }
  ],
  special: [
    { id: "voix-robot", label: "Voix robot" },
    { id: "voix-ia-futuriste", label: "Voix IA futuriste" },
    { id: "voix-mysterieuse", label: "Voix mystérieuse" },
    { id: "voix-froide", label: "Voix froide" }
  ]
};

const state = {
  route: "profiles",
  history: [],
  profile: null,
  theme: "theme-dark",
  adminPassword: ADMIN_PASSWORD_DEFAULT,
  customBlocks: [],
  libraryMode: "music",
  libraryType: "image",
  libraryBlockFilter: "all",
  currentResultId: null,
  temp: {
    renderBusyProjectId: null,

    musicAudioFile: null,
    musicAudioUrl: "",
    musicAudioDuration: 0,
    musicAnalyzing: false,
    musicIdeasLoading: false,
    musicPilotLoading: false,
    musicAnalysis: null,
    musicClipIdeas: null,
    musicMontagePlan: null,
    musicMetaGeneral: "",
    musicMetaShorts: "",
    musicDraft: {
      id: null,
      name: "",
      start: 0,
      end: 0,
      targetDuration: "30",
      style: "social",
      mode: "video",
      montageMode: "auto",
      aspectRatio: "vertical",
      mediaSourceMode: "single",
      primaryBlock: "Vrac",
      allowedBlocks: ["Vrac"],
      selectedMediaIds: []
    },

    speechAudioBlob: null,
    speechAudioUrl: "",
    speechMetaGeneral: "",
    speechMetaShorts: "",
    speechGenerating: false,
    speechDraft: {
      id: null,
      name: "",
      text: "",
      voiceFamily: "naturel",
      voiceStyle: "masculin-naturel",
      tone: "normal",
      speed: "1",
      mode: "video",
      montageMode: "auto",
      aspectRatio: "vertical",
      targetDuration: "30",
      mediaSourceMode: "single",
      primaryBlock: "Moi",
      allowedBlocks: ["Moi"],
      selectedMediaIds: []
    },

    soraAudioFile: null,
    soraAudioUrl: "",
    soraAudioDuration: 0,
    soraDraft: {
      id: null,
      name: "",
      start: 0,
      end: 0,
      style: "realisme"
    },
    soraDuration: 10,
    lastSoraPrompts: []
  },
  cache: {
    projects: [],
    media: []
  }
};

let dbPromise = null;

const screen = document.getElementById("screen");
const backButton = document.getElementById("backButton");
const themeToggle = document.getElementById("themeToggle");
const bottomNav = document.getElementById("bottomNav");
const bottomTabs = [...document.querySelectorAll(".bottom-tab")];
const toast = document.getElementById("toast");
const appTitle = document.getElementById("appTitle");

/* =========================
   DB
========================= */
function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("projects")) {
        const store = db.createObjectStore("projects", { keyPath: "id" });
        store.createIndex("owner", "owner", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }

      if (!db.objectStoreNames.contains("media")) {
        const store = db.createObjectStore("media", { keyPath: "id" });
        store.createIndex("owner", "owner", { unique: false });
        store.createIndex("bucket", "bucket", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function getStore(name, mode = "readonly") {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

async function kvGet(key, fallback = null) {
  const store = await getStore("kv");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const store = await getStore("kv", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function projectPut(project) {
  const store = await getStore("projects", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(project);
    req.onsuccess = () => resolve(project);
    req.onerror = () => reject(req.error);
  });
}

async function projectDelete(id) {
  const store = await getStore("projects", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function projectListByOwner(owner) {
  const store = await getStore("projects");
  return new Promise((resolve, reject) => {
    const req = store.index("owner").getAll(owner);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function mediaPut(media) {
  const store = await getStore("media", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(media);
    req.onsuccess = () => resolve(media);
    req.onerror = () => reject(req.error);
  });
}

async function mediaDelete(id) {
  const store = await getStore("media", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function mediaListByOwner(owner) {
  const store = await getStore("media");
  return new Promise((resolve, reject) => {
    const req = store.index("owner").getAll(owner);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function mediaGetById(id) {
  const store = await getStore("media");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* =========================
   Utils
========================= */
function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function safeText(value) {
  return (value || "").toString().trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return `${safe.toFixed(1).replace(".0", "")} s`;
  const m = Math.floor(safe / 60);
  const s = Math.round(safe % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function bytesToMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function profileLabel(profile) {
  return {
    admin: "Admin",
    user1: "Yvane",
    user2: "Nelvyn",
    user3: "Utilisateur 3"
  }[profile] || "Profil";
}

function projectTypeLabel(type) {
  return {
    music: "Montage musique",
    speech: "Voix IA",
    sora: "Prompts vidéo"
  }[type] || "Projet";
}

function aspectRatioLabel(value) {
  return value === "horizontal" ? "Horizontal 16:9" : "Vertical 9:16";
}

function sourceModeLabel(value) {
  return {
    single: "Bloc précis",
    multi: "Plusieurs blocs",
    ai: "IA choisit les blocs"
  }[value] || "Bloc précis";
}

function montageModeLabel(mode) {
  return mode === "manual" ? "Montage manuel" : "Montage automatique";
}

function montageModeHelp(mode) {
  return mode === "manual"
    ? "Tu choisis l’ordre des médias avant le rendu."
    : "L’application place les médias toute seule.";
}

function sourceModeHelp(mode) {
  if (mode === "single") return "Le projet cherche dans un seul bloc.";
  if (mode === "multi") return "Le projet cherche dans plusieurs blocs choisis.";
  return "L’IA peut chercher dans les blocs compatibles.";
}

function mediaOrientationLabel(value) {
  return {
    vertical: "Vertical",
    horizontal: "Horizontal",
    square: "Carré",
    unknown: "Inconnu"
  }[value] || "Inconnu";
}

function orientationMatches(targetRatio, mediaOrientation) {
  if (targetRatio === "vertical") {
    return ["vertical", "square", "unknown"].includes(mediaOrientation || "unknown");
  }
  return ["horizontal", "square", "unknown"].includes(mediaOrientation || "unknown");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

function resetObjectUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copié.");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    showToast("Copié.");
  }
}

function escapeHtml(text) {
  return (text || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delay = 400) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function stringifyPretty(value) {
  return JSON.stringify(value, null, 2);
}

function speechDraftKey(profile) {
  return `speech_draft_${profile}`;
}

function musicDraftKey(profile) {
  return `music_draft_${profile}`;
}

function soraDraftKey(profile) {
  return `sora_draft_${profile}`;
}

function allMediaBlocks() {
  return [...new Set([...DEFAULT_MEDIA_BLOCKS, ...(state.customBlocks || [])])];
}

function normalizeBlock(value) {
  return safeText(value) || "Vrac";
}

function getStylesForFamily(family) {
  return VOICE_STYLE_GROUPS[family] || VOICE_STYLE_GROUPS.naturel;
}

function ensureStyleInFamily(family, styleId) {
  const styles = getStylesForFamily(family);
  return styles.some((item) => item.id === styleId) ? styleId : styles[0].id;
}

function findVoiceLabel(styleId) {
  const all = Object.values(VOICE_STYLE_GROUPS).flat();
  return all.find((item) => item.id === styleId)?.label || styleId;
}

function getBucketForProject(projectType, mode) {
  return `${projectType}-${mode === "video" ? "video" : "image"}`;
}

function getMediaPreviewUrl(media) {
  return URL.createObjectURL(media.blob);
}

function triggerDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function getBlobDuration(blob, kind = "audio") {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const url = URL.createObjectURL(blob);
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
  });
}

function moveItem(array, fromIndex, toIndex) {
  const copy = [...array];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function getDraftBlocks(draft) {
  if (!draft) return [];
  if (draft.mediaSourceMode === "single") return [normalizeBlock(draft.primaryBlock)];
  if (draft.mediaSourceMode === "multi") return (draft.allowedBlocks || []).map(normalizeBlock).filter(Boolean);
  return allMediaBlocks();
}

function filterMediaForDraft(projectKind, draft) {
  const bucket = getBucketForProject(projectKind, draft.mode || "video");
  const allowedBlocks = getDraftBlocks(draft);

  return state.cache.media
    .filter((item) => item.bucket === bucket)
    .filter((item) => orientationMatches(draft.aspectRatio || "vertical", item.orientation || "unknown"))
    .filter((item) => {
      if (draft.mediaSourceMode === "ai") return true;
      return allowedBlocks.includes(normalizeBlock(item.block));
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function mapMediaCandidatesForAi(projectKind, draft) {
  return filterMediaForDraft(projectKind, draft).map((item) => ({
    id: item.id,
    fileName: item.fileName,
    block: item.block,
    orientation: item.orientation,
    mediaType: item.mediaType,
    tags: item.tags || []
  }));
}

function buildMusicGeminiContext(draft) {
  const blocks = getDraftBlocks(draft);
  return [
    `format=${aspectRatioLabel(draft.aspectRatio)}`,
    `source=${sourceModeLabel(draft.mediaSourceMode)}`,
    `blocs=${blocks.join(", ")}`,
    `style=${draft.style}`,
    `mode=${draft.mode === "video" ? "videos" : "images"}`,
    `duree=${draft.targetDuration}s`
  ].join(" | ");
}

async function detectFileOrientation(file, mediaType) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);

    if (mediaType === "image") {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        URL.revokeObjectURL(url);
        if (!w || !h) return resolve("unknown");
        if (Math.abs(w - h) < 10) return resolve("square");
        resolve(h > w ? "vertical" : "horizontal");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("unknown");
      };
      img.src = url;
      return;
    }

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      URL.revokeObjectURL(url);
      if (!w || !h) return resolve("unknown");
      if (Math.abs(w - h) < 10) return resolve("square");
      resolve(h > w ? "vertical" : "horizontal");
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("unknown");
    };
    video.src = url;
  });
}

/* =========================
   Gemini + AI rendering blocks
========================= */
function renderMusicAnalysisHtml(analysis) {
  if (!analysis) {
    return `<div class="empty-state">Aucune analyse Gemini.</div>`;
  }

  if (analysis.raw) {
    return `<pre class="meta-output">${escapeHtml(analysis.raw)}</pre>`;
  }

  const emotions = Array.isArray(analysis.emotions) ? analysis.emotions : [];
  const hookMoments = Array.isArray(analysis.hookMoments) ? analysis.hookMoments : [];
  const sceneIdeas = Array.isArray(analysis.sceneIdeas) ? analysis.sceneIdeas : [];
  const editingAdvice = Array.isArray(analysis.editingAdvice) ? analysis.editingAdvice : [];

  return `
    <div class="card-list">
      <div class="project-card"><h3 class="project-title">Résumé</h3><div class="small-note">${escapeHtml(analysis.summary || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Ambiance</h3><div class="small-note">${escapeHtml(analysis.dominantMood || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Énergie</h3><div class="small-note">${escapeHtml(analysis.energyLevel || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Rythme</h3><div class="small-note">${escapeHtml(analysis.rhythmEstimate || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Univers visuel</h3><div class="small-note">${escapeHtml(analysis.visualUniverse || "—")}</div></div>
      ${emotions.length ? `<div class="project-card"><h3 class="project-title">Émotions</h3><div class="small-note">${emotions.map((v) => escapeHtml(v)).join(" • ")}</div></div>` : ""}
      ${hookMoments.length ? `<div class="project-card"><h3 class="project-title">Moments forts</h3><div class="small-note">${hookMoments.map((v) => `- ${escapeHtml(v)}`).join("<br>")}</div></div>` : ""}
      ${sceneIdeas.length ? `<div class="project-card"><h3 class="project-title">Idées de scènes</h3><div class="small-note">${sceneIdeas.map((v) => `- ${escapeHtml(v)}`).join("<br>")}</div></div>` : ""}
      ${editingAdvice.length ? `<div class="project-card"><h3 class="project-title">Conseils montage</h3><div class="small-note">${editingAdvice.map((v) => `- ${escapeHtml(v)}`).join("<br>")}</div></div>` : ""}
      ${analysis.soraDirection ? `<div class="project-card"><h3 class="project-title">Direction clip</h3><div class="small-note">${escapeHtml(analysis.soraDirection)}</div></div>` : ""}
    </div>
  `;
}

function renderMusicClipIdeasHtml(ideas) {
  if (!ideas) {
    return `<div class="empty-state">Aucune idée de clip.</div>`;
  }

  if (ideas.raw) {
    return `<pre class="meta-output">${escapeHtml(ideas.raw)}</pre>`;
  }

  const storyArc = Array.isArray(ideas.storyArc) ? ideas.storyArc : [];
  const shortPromptIdeas = Array.isArray(ideas.shortPromptIdeas) ? ideas.shortPromptIdeas : [];

  return `
    <div class="card-list">
      <div class="project-card"><h3 class="project-title">Direction créative</h3><div class="small-note">${escapeHtml(ideas.creativeDirection || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Style visuel</h3><div class="small-note">${escapeHtml(ideas.visualStyle || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Caméra</h3><div class="small-note">${escapeHtml(ideas.cameraStyle || "—")}</div></div>
      <div class="project-card"><h3 class="project-title">Palette</h3><div class="small-note">${escapeHtml(ideas.colorPalette || "—")}</div></div>
      ${storyArc.length ? `<div class="project-card"><h3 class="project-title">Structure clip</h3><div class="small-note">${storyArc.map((v) => `- ${escapeHtml(v)}`).join("<br>")}</div></div>` : ""}
      ${shortPromptIdeas.length ? `<div class="project-card"><h3 class="project-title">Idées rapides</h3><div class="small-note">${shortPromptIdeas.map((v) => `- ${escapeHtml(v)}`).join("<br>")}</div></div>` : ""}
    </div>
  `;
}

function renderMusicMontagePlanHtml(plan) {
  if (!plan) {
    return `<div class="empty-state">Aucun pilotage IA pour le moment.</div>`;
  }

  if (plan.raw) {
    return `<pre class="meta-output">${escapeHtml(plan.raw)}</pre>`;
  }

  const timeline = Array.isArray(plan.timeline) ? plan.timeline : [];

  return `
    <div class="card-list">
      <div class="project-card">
        <h3 class="project-title">Transition</h3>
        <div class="small-note">${escapeHtml(plan.transitionStyle || "cut")}</div>
      </div>
      <div class="project-card">
        <h3 class="project-title">Effet</h3>
        <div class="small-note">${escapeHtml(plan.effectStyle || "clean")}</div>
      </div>
      <div class="project-card">
        <h3 class="project-title">Médias retenus</h3>
        <div class="small-note">${Array.isArray(plan.selectedMediaIds) ? plan.selectedMediaIds.join(" • ") : "—"}</div>
      </div>
      ${timeline.length ? `
        <div class="project-card">
          <h3 class="project-title">Timeline IA</h3>
          <div class="small-note">
            ${timeline.map((item, idx) => {
              const media = state.cache.media.find((m) => m.id === item.mediaId);
              const name = media?.fileName || item.mediaId;
              return `${idx + 1}. ${escapeHtml(name)} - ${formatSeconds(item.start || 0)} à ${formatSeconds(item.end || 0)} - ${escapeHtml(item.transition || "cut")} - ${escapeHtml(item.effect || "clean")}`;
            }).join("<br>")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function openMediaViewer(mediaId) {
  const media = state.cache.media.find((m) => m.id === mediaId);
  if (!media) return;

  const url = getMediaPreviewUrl(media);

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.82)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "16px";

  const card = document.createElement("div");
  card.style.width = "100%";
  card.style.maxWidth = "520px";
  card.style.background = "#111827";
  card.style.borderRadius = "18px";
  card.style.padding = "16px";
  card.style.color = "#fff";
  card.style.maxHeight = "90vh";
  card.style.overflow = "auto";

  const title = document.createElement("div");
  title.style.fontSize = "16px";
  title.style.fontWeight = "700";
  title.style.marginBottom = "12px";
  title.textContent = media.fileName;

  const previewWrap = document.createElement("div");
  previewWrap.style.borderRadius = "14px";
  previewWrap.style.overflow = "hidden";
  previewWrap.style.background = "#000";
  previewWrap.style.marginBottom = "12px";

  if (media.mediaType === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = media.fileName;
    img.style.width = "100%";
    img.style.display = "block";
    previewWrap.appendChild(img);
  } else {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.display = "block";
    previewWrap.appendChild(video);
  }

  const info = document.createElement("div");
  info.style.fontSize = "13px";
  info.style.opacity = "0.9";
  info.style.marginBottom = "12px";
  info.innerHTML = `
    <div>Type : ${media.mediaType}</div>
    <div>Bloc : ${escapeHtml(media.block || "Vrac")}</div>
    <div>Orientation : ${escapeHtml(mediaOrientationLabel(media.orientation || "unknown"))}</div>
    <div>Taille : ${bytesToMB(media.size || 0)}</div>
    <div>Créé : ${formatDate(media.createdAt)}</div>
  `;

  const actions = document.createElement("div");
  actions.style.display = "grid";
  actions.style.gridTemplateColumns = "1fr 1fr";
  actions.style.gap = "10px";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Fermer";
  closeBtn.style.padding = "12px";
  closeBtn.style.borderRadius = "12px";
  closeBtn.style.border = "none";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Supprimer";
  deleteBtn.style.padding = "12px";
  deleteBtn.style.borderRadius = "12px";
  deleteBtn.style.border = "none";

  closeBtn.onclick = () => {
    URL.revokeObjectURL(url);
    overlay.remove();
  };

  deleteBtn.onclick = async () => {
    const confirmed = window.confirm("Supprimer ce média ?");
    if (!confirmed) return;
    URL.revokeObjectURL(url);
    overlay.remove();
    await deleteMediaEverywhere(media.id);
  };

  actions.appendChild(closeBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(title);
  card.appendChild(previewWrap);
  card.appendChild(info);
  card.appendChild(actions);

  overlay.appendChild(card);
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      URL.revokeObjectURL(url);
      overlay.remove();
    }
  };

  document.body.appendChild(overlay);
}

/* =========================
   Theme
========================= */
async function applyTheme(theme) {
  state.theme = theme === "theme-light" ? "theme-light" : "theme-dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(state.theme);
  themeToggle.textContent = state.theme === "theme-dark" ? "Mode clair" : "Mode sombre";
  await kvSet("theme", state.theme);
}

async function toggleTheme() {
  const next = state.theme === "theme-dark" ? "theme-light" : "theme-dark";
  await applyTheme(next);
  render();
}

/* =========================
   API
========================= */
async function postJson(path, body) {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = null;
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    throw new Error(data?.error || "Erreur serveur");
  }

  return data;
}

async function postGeminiJson(path, body) {
  const response = await fetch(`${GEMINI_BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = null;
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    throw new Error(data?.error || "Erreur Gemini");
  }

  return data;
}

async function postGeminiForm(path, formData) {
  const response = await fetch(`${GEMINI_BACKEND_URL}${path}`, {
    method: "POST",
    body: formData
  });

  let data = null;
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    throw new Error(data?.error || "Erreur Gemini");
  }

  return data;
}

/* =========================
   Custom blocks
========================= */
async function loadCustomBlocks() {
  state.customBlocks = await kvGet("media_custom_blocks", []);
  if (!Array.isArray(state.customBlocks)) state.customBlocks = [];
}

async function saveCustomBlocks() {
  await kvSet("media_custom_blocks", state.customBlocks);
}

/* =========================
   Draft persistence
========================= */
async function saveSpeechDraft() {
  if (!state.profile) return;
  await kvSet(speechDraftKey(state.profile), {
    draft: state.temp.speechDraft,
    metaGeneral: state.temp.speechMetaGeneral,
    metaShorts: state.temp.speechMetaShorts,
    audioBlob: state.temp.speechAudioBlob || null
  });
}

async function loadSpeechDraft() {
  if (!state.profile) return;
  const data = await kvGet(speechDraftKey(state.profile), null);
  if (!data) return;

  state.temp.speechDraft = { ...state.temp.speechDraft, ...(data.draft || {}) };
  state.temp.speechDraft.voiceFamily = state.temp.speechDraft.voiceFamily || "naturel";
  state.temp.speechDraft.voiceStyle = ensureStyleInFamily(
    state.temp.speechDraft.voiceFamily,
    state.temp.speechDraft.voiceStyle || "masculin-naturel"
  );
  state.temp.speechDraft.primaryBlock = normalizeBlock(state.temp.speechDraft.primaryBlock || "Moi");
  state.temp.speechDraft.allowedBlocks = Array.isArray(state.temp.speechDraft.allowedBlocks)
    ? state.temp.speechDraft.allowedBlocks
    : [state.temp.speechDraft.primaryBlock];

  state.temp.speechMetaGeneral = data.metaGeneral || "";
  state.temp.speechMetaShorts = data.metaShorts || "";

  resetObjectUrl(state.temp.speechAudioUrl);
  state.temp.speechAudioBlob = data.audioBlob || null;
  state.temp.speechAudioUrl = data.audioBlob ? URL.createObjectURL(data.audioBlob) : "";
}

async function saveMusicDraft() {
  if (!state.profile) return;
  await kvSet(musicDraftKey(state.profile), {
    draft: state.temp.musicDraft,
    audioBlob: state.temp.musicAudioFile || null,
    analysis: state.temp.musicAnalysis || null,
    clipIdeas: state.temp.musicClipIdeas || null,
    montagePlan: state.temp.musicMontagePlan || null,
    metaGeneral: state.temp.musicMetaGeneral || "",
    metaShorts: state.temp.musicMetaShorts || ""
  });
}

async function loadMusicDraft() {
  if (!state.profile) return;
  const data = await kvGet(musicDraftKey(state.profile), null);
  if (!data) return;

  state.temp.musicDraft = { ...state.temp.musicDraft, ...(data.draft || {}) };
  state.temp.musicDraft.primaryBlock = normalizeBlock(state.temp.musicDraft.primaryBlock || "Vrac");
  state.temp.musicDraft.allowedBlocks = Array.isArray(state.temp.musicDraft.allowedBlocks)
    ? state.temp.musicDraft.allowedBlocks
    : [state.temp.musicDraft.primaryBlock];

  state.temp.musicAnalysis = data.analysis || null;
  state.temp.musicClipIdeas = data.clipIdeas || null;
  state.temp.musicMontagePlan = data.montagePlan || null;
  state.temp.musicMetaGeneral = data.metaGeneral || "";
  state.temp.musicMetaShorts = data.metaShorts || "";

  resetObjectUrl(state.temp.musicAudioUrl);
  state.temp.musicAudioFile = data.audioBlob || null;
  state.temp.musicAudioUrl = data.audioBlob ? URL.createObjectURL(data.audioBlob) : "";
}

async function saveSoraDraft() {
  if (!state.profile) return;
  await kvSet(soraDraftKey(state.profile), {
    draft: state.temp.soraDraft,
    promptDuration: state.temp.soraDuration,
    audioBlob: state.temp.soraAudioFile || null,
    prompts: state.temp.lastSoraPrompts || []
  });
}

async function loadSoraDraft() {
  if (!state.profile) return;
  const data = await kvGet(soraDraftKey(state.profile), null);
  if (!data) return;

  state.temp.soraDraft = { ...state.temp.soraDraft, ...(data.draft || {}) };
  state.temp.soraDuration = [10, 15].includes(Number(data.promptDuration))
    ? Number(data.promptDuration)
    : state.temp.soraDuration;

  resetObjectUrl(state.temp.soraAudioUrl);
  state.temp.soraAudioFile = data.audioBlob || null;
  state.temp.soraAudioUrl = data.audioBlob ? URL.createObjectURL(data.audioBlob) : "";
  state.temp.lastSoraPrompts = Array.isArray(data.prompts) ? data.prompts : [];
}

/* =========================
   Cache
========================= */
async function hydrateCache() {
  if (!state.profile) {
    state.cache.projects = [];
    state.cache.media = [];
    return;
  }

  const [projects, media] = await Promise.all([
    projectListByOwner(state.profile),
    mediaListByOwner(state.profile)
  ]);

  state.cache.projects = projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  state.cache.media = media
    .map((item) => ({
      ...item,
      block: normalizeBlock(item.block || "Vrac"),
      orientation: item.orientation || "unknown",
      tags: Array.isArray(item.tags) ? item.tags : []
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* =========================
   Navigation
========================= */
function setRoute(route, push = true) {
  if (push && state.route !== route) state.history.push(state.route);
  state.route = route;
  render();
}

function goBack() {
  if (!state.history.length) {
    state.route = state.profile ? "dashboard" : "profiles";
  } else {
    state.route = state.history.pop();
  }
  render();
}

function updateChrome() {
  const titles = {
    profiles: "Choix du compte",
    adminLogin: "Connexion admin",
    dashboard: "Accueil",
    musicProject: "Montage musique",
    speechProject: "Voix IA",
    library: "Bibliothèque médias",
    projects: "Mes projets",
    settings: "Paramètres",
    result: "Résultat",
    sora: "Prompts vidéo"
  };

  appTitle.textContent = titles[state.route] || APP_NAME;

  const showBack = state.profile && !["dashboard", "profiles"].includes(state.route);
  backButton.classList.toggle("hidden", !showBack);

  bottomNav.classList.toggle("hidden", !state.profile);
  bottomTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route === state.route);
  });
}

/* =========================
   Templates
========================= */
function panel(title, description, content) {
  return `
    <section class="screen">
      <div class="panel">
        <div class="panel-head">
          <h2>${title}</h2>
          <p>${description}</p>
        </div>
        ${content}
      </div>
    </section>
  `;
}

function profilesTemplate() {
  return `
    <section class="screen">
      <div class="hero-card">
        <p class="hero-kicker">Bienvenue</p>
        <h2>Choisis ton compte</h2>
        <p class="hero-text">Admin pour gérer l’application. Yvane et Nelvyn ont leur espace séparé.</p>
      </div>

      <div class="profile-grid">
        <button class="profile-card admin-card" data-action="open-admin">
          <span class="profile-badge">Admin</span>
          <span class="profile-name">Administrateur</span>
          <span class="profile-desc">Réglages, gestion, pilotage</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user1">
          <span class="profile-badge">Yvane</span>
          <span class="profile-name">Compte Yvane</span>
          <span class="profile-desc">Ses médias, ses projets, ses vidéos</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user2">
          <span class="profile-badge">Nelvyn</span>
          <span class="profile-name">Compte Nelvyn</span>
          <span class="profile-desc">Ses médias, ses projets, ses vidéos</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user3">
          <span class="profile-badge">Utilisateur 3</span>
          <span class="profile-name">Compte invité</span>
          <span class="profile-desc">Zone libre de test</span>
        </button>
      </div>
    </section>
  `;
}

function adminLoginTemplate() {
  return panel(
    "Connexion admin",
    "Entre le mot de passe administrateur.",
    `
      <form id="adminLoginForm" class="stack-form">
        <label class="field">
          <span>Mot de passe admin</span>
          <input id="adminPasswordInput" type="password" placeholder="Entre le mot de passe" autocomplete="current-password" />
        </label>
        <button class="primary-btn" type="submit">Entrer</button>
      </form>
    `
  );
}

function dashboardTemplate() {
  return `
    <section class="screen">
      <div class="hero-card">
        <p class="hero-kicker">Accueil</p>
        <h2>Bienvenue, ${profileLabel(state.profile)}</h2>
        <p class="hero-text">Choisis une action simple : voix, musique, prompts, projets ou bibliothèque.</p>
      </div>

      <div class="action-grid">
        <button class="action-card" data-action="go-route" data-route="speechProject">
          <span class="action-icon">🗣️</span>
          <span class="action-title">Voix IA</span>
          <span class="action-desc">Texte + voix + médias + vidéo</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="musicProject">
          <span class="action-icon">🎵</span>
          <span class="action-title">Montage musique</span>
          <span class="action-desc">Audio + blocs + IA + vidéo</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="sora">
          <span class="action-icon">✨</span>
          <span class="action-title">Prompts vidéo</span>
          <span class="action-desc">Découpe audio et prompts 10 s / 15 s</span>
        </button>

        <button class="action-card" data-action="open-library" data-mode="music" data-type="image">
          <span class="action-icon">🖼️</span>
          <span class="action-title">Bibliothèque médias</span>
          <span class="action-desc">Classe les médias par bloc et orientation</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="projects">
          <span class="action-icon">📁</span>
          <span class="action-title">Mes projets</span>
          <span class="action-desc">Reprendre, rendre, télécharger</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="settings">
          <span class="action-icon">⚙️</span>
          <span class="action-title">Paramètres</span>
          <span class="action-desc">Thème, stockage, nettoyage</span>
        </button>

        <button class="action-card" data-action="logout">
          <span class="action-icon">↩️</span>
          <span class="action-title">Changer de compte</span>
          <span class="action-desc">Retour à l’écran d’accueil</span>
        </button>
      </div>
    </section>
  `;
}

function renderBlockSelectOptions(selectedValue) {
  return allMediaBlocks()
    .map((block) => `<option value="${escapeHtml(block)}" ${selectedValue === block ? "selected" : ""}>${escapeHtml(block)}</option>`)
    .join("");
}

function renderBlockCheckboxes(name, selectedValues) {
  const selected = new Set(selectedValues || []);
  return `
    <div class="card-list">
      ${allMediaBlocks().map((block) => `
        <label class="project-card" style="display:flex;align-items:center;gap:12px;">
          <input type="checkbox" name="${name}" value="${escapeHtml(block)}" ${selected.has(block) ? "checked" : ""} />
          <div><div class="project-title">${escapeHtml(block)}</div></div>
        </label>
      `).join("")}
    </div>
  `;
}

function renderDurationOptions(selected) {
  return DURATION_OPTIONS.map((v) => `<option value="${v}" ${selected === v ? "selected" : ""}>${v} secondes</option>`).join("");
}

function renderSelectableMediaCards(kind, draft, selectedIds = []) {
  const items = filterMediaForDraft(kind, draft);

  if (!items.length) {
    return `<div class="empty-state"><p>Aucun média compatible avec ce format et cette source.</p></div>`;
  }

  return `
    <div class="media-grid">
      ${items.map((item) => {
        const selected = selectedIds.includes(item.id);
        const previewUrl = getMediaPreviewUrl(item);
        return `
          <div class="media-card">
            <button type="button" data-action="open-media-viewer" data-id="${item.id}" style="all:unset;display:block;width:100%;cursor:pointer;">
              ${item.mediaType === "image"
                ? `<img src="${previewUrl}" alt="${escapeHtml(item.fileName)}" />`
                : `<video src="${previewUrl}" muted playsinline></video>`
              }
            </button>
            <div class="media-card-label">${selected ? "✓ " : ""}${escapeHtml(item.fileName)}</div>
            <div class="small-note">${escapeHtml(item.block || "Vrac")} • ${escapeHtml(mediaOrientationLabel(item.orientation || "unknown"))}</div>
            <div class="prompt-actions">
              <button type="button" data-action="toggle-project-media" data-kind="${kind}" data-media-id="${item.id}">
                ${selected ? "Retirer" : "Ajouter"}
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderSelectedMediaOrder(kind, selectedIds = []) {
  if (!selectedIds.length) {
    return `<div class="empty-state"><p>Aucun média sélectionné.</p></div>`;
  }

  const mediaList = selectedIds
    .map((id) => state.cache.media.find((m) => m.id === id))
    .filter(Boolean);

  return `
    <div class="card-list">
      ${mediaList.map((media, index) => `
        <div class="project-card">
          <div class="project-card-top">
            <div>
              <h3 class="project-title">${index + 1}. ${escapeHtml(media.fileName)}</h3>
              <div class="small-note">${escapeHtml(media.block || "Vrac")} • ${escapeHtml(mediaOrientationLabel(media.orientation || "unknown"))}</div>
            </div>
          </div>
          <div class="project-actions">
            <button type="button" data-action="move-project-media" data-kind="${kind}" data-index="${index}" data-direction="-1">Monter</button>
            <button type="button" data-action="move-project-media" data-kind="${kind}" data-index="${index}" data-direction="1">Descendre</button>
            <button type="button" data-action="remove-project-media" data-kind="${kind}" data-index="${index}">Retirer</button>
            <button type="button" data-action="open-media-viewer" data-id="${media.id}">Voir</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function musicProjectTemplate() {
  const draft = state.temp.musicDraft;
  const selectedIds = draft.selectedMediaIds || [];

  return panel(
    "Montage musique",
    "1. Ajoute la musique - 2. Choisis le format - 3. Choisis la source des médias - 4. Analyse / pilotage IA - 5. Crée la vidéo.",
    `
      <form id="musicProjectForm" class="stack-form">
        <label class="field">
          <span>Nom du projet</span>
          <input id="musicProjectName" type="text" placeholder="Ex : Clip sombre 1" value="${escapeHtml(draft.name)}" />
        </label>

        <label class="field">
          <span>Musique principale</span>
          <input id="musicAudioInput" type="file" accept="audio/*" />
        </label>

        <div class="media-preview-card">
          <audio id="musicAudioPlayer" controls preload="metadata" ${state.temp.musicAudioUrl ? `src="${state.temp.musicAudioUrl}"` : ""}></audio>
          <div class="audio-meta">
            <p><strong>Début :</strong> <span id="musicStartLabel">${formatSeconds(Number(draft.start || 0))}</span></p>
            <p><strong>Fin :</strong> <span id="musicEndLabel">${formatSeconds(Number(draft.end || 0))}</span></p>
            <p><strong>Durée utile :</strong> <span id="musicRangeLabel">${formatSeconds(Math.max(0, Number(draft.end || 0) - Number(draft.start || 0)))}</span></p>
          </div>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Début audio</span>
            <input id="musicStartTime" type="number" min="0" step="0.1" value="${Number(draft.start || 0)}" />
          </label>
          <label class="field">
            <span>Fin audio</span>
            <input id="musicEndTime" type="number" min="0" step="0.1" value="${Number(draft.end || 0)}" />
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Durée finale</span>
            <select id="musicDuration">${renderDurationOptions(draft.targetDuration)}</select>
          </label>
          <label class="field">
            <span>Type de médias</span>
            <select id="musicMode">
              <option value="video" ${draft.mode === "video" ? "selected" : ""}>Montage avec vidéos</option>
              <option value="image" ${draft.mode === "image" ? "selected" : ""}>Montage avec images</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Format final</span>
            <select id="musicAspectRatio">
              <option value="vertical" ${draft.aspectRatio === "vertical" ? "selected" : ""}>Vertical 9:16</option>
              <option value="horizontal" ${draft.aspectRatio === "horizontal" ? "selected" : ""}>Horizontal 16:9</option>
            </select>
          </label>
          <label class="field">
            <span>Source des médias</span>
            <select id="musicSourceMode">
              <option value="single" ${draft.mediaSourceMode === "single" ? "selected" : ""}>Bloc précis</option>
              <option value="multi" ${draft.mediaSourceMode === "multi" ? "selected" : ""}>Plusieurs blocs</option>
              <option value="ai" ${draft.mediaSourceMode === "ai" ? "selected" : ""}>IA choisit les blocs</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Mode de montage</span>
            <select id="musicMontageMode">
              <option value="auto" ${draft.montageMode === "auto" ? "selected" : ""}>Montage automatique</option>
              <option value="manual" ${draft.montageMode === "manual" ? "selected" : ""}>Montage manuel</option>
            </select>
          </label>
          <label class="field">
            <span>Style dominant</span>
            <select id="musicStyle">
              <option value="social" ${draft.style === "social" ? "selected" : ""}>Social</option>
              <option value="cinematique" ${draft.style === "cinematique" ? "selected" : ""}>Cinématique</option>
              <option value="emotion" ${draft.style === "emotion" ? "selected" : ""}>Émotion</option>
              <option value="sombre" ${draft.style === "sombre" ? "selected" : ""}>Sombre</option>
            </select>
          </label>
        </div>

        <p class="small-note">${sourceModeHelp(draft.mediaSourceMode)}</p>
        <p class="small-note">${montageModeHelp(draft.montageMode)}</p>

        ${draft.mediaSourceMode === "single" ? `
          <label class="field">
            <span>Bloc choisi</span>
            <select id="musicPrimaryBlock">
              ${renderBlockSelectOptions(draft.primaryBlock)}
            </select>
          </label>
        ` : ""}

        ${draft.mediaSourceMode === "multi" ? `
          <div class="result-box">
            <div class="result-box-head"><h3>Blocs autorisés</h3></div>
            ${renderBlockCheckboxes("musicAllowedBlocks", draft.allowedBlocks || [])}
          </div>
        ` : ""}

        <div class="result-box">
          <div class="result-box-head">
            <h3>Médias compatibles</h3>
            <button class="chip-btn" type="button" data-action="open-library" data-mode="music" data-type="${draft.mode === "video" ? "video" : "image"}">Ouvrir ma bibliothèque</button>
          </div>
          ${renderSelectableMediaCards("music", draft, selectedIds)}
        </div>

        <div class="result-box">
          <div class="result-box-head"><h3>Ordre du montage</h3></div>
          ${renderSelectedMediaOrder("music", selectedIds)}
        </div>

        <div class="sticky-actions">
          <button id="musicAnalyzeBtn" class="secondary-btn" type="button">${state.temp.musicAnalyzing ? "Analyse..." : "Analyser la musique"}</button>
          <button id="musicIdeasBtn" class="secondary-btn" type="button">${state.temp.musicIdeasLoading ? "Création..." : "Créer idée de clip"}</button>
          <button id="musicPilotBtn" class="secondary-btn" type="button">${state.temp.musicPilotLoading ? "Pilotage..." : "Pilotage IA complet"}</button>
          <button class="primary-btn" type="submit">Créer la vidéo musique</button>
        </div>
      </form>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Analyse Gemini</h3>
          <button class="chip-btn" type="button" data-action="copy-music-analysis">Copier</button>
        </div>
        ${renderMusicAnalysisHtml(state.temp.musicAnalysis)}
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Idée de clip Gemini</h3>
          <button class="chip-btn" type="button" data-action="copy-music-ideas">Copier</button>
        </div>
        ${renderMusicClipIdeasHtml(state.temp.musicClipIdeas)}
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Plan de montage IA</h3>
          <button class="chip-btn" type="button" data-action="copy-music-plan">Copier</button>
        </div>
        ${renderMusicMontagePlanHtml(state.temp.musicMontagePlan)}
      </div>
    `
  );
}

function speechProjectTemplate() {
  const draft = state.temp.speechDraft;
  const styles = getStylesForFamily(draft.voiceFamily);
  const selectedIds = draft.selectedMediaIds || [];

  return panel(
    "Voix IA",
    "Texte + voix + format + blocs + vidéo.",
    `
      <form id="speechProjectForm" class="stack-form">
        <label class="field">
          <span>Nom du projet</span>
          <input id="speechProjectName" type="text" placeholder="Ex : Narration teaser 1" value="${escapeHtml(draft.name)}" />
        </label>

        <label class="field">
          <span>Texte à lire</span>
          <textarea id="speechText" rows="8" placeholder="Colle ton texte ici...">${escapeHtml(draft.text)}</textarea>
        </label>

        <div class="row-2">
          <label class="field">
            <span>Famille de voix</span>
            <select id="speechVoiceFamily">
              ${Object.entries(VOICE_FAMILY_LABELS).map(([key, label]) => `<option value="${key}" ${draft.voiceFamily === key ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Style de voix</span>
            <select id="speechVoiceStyle">
              ${styles.map((item) => `<option value="${item.id}" ${draft.voiceStyle === item.id ? "selected" : ""}>${item.label}</option>`).join("")}
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Ton</span>
            <select id="speechTone">
              <option value="normal" ${draft.tone === "normal" ? "selected" : ""}>Normal</option>
              <option value="emotion" ${draft.tone === "emotion" ? "selected" : ""}>Émotion</option>
              <option value="calm" ${draft.tone === "calm" ? "selected" : ""}>Calme</option>
              <option value="energetic" ${draft.tone === "energetic" ? "selected" : ""}>Énergique</option>
            </select>
          </label>
          <label class="field">
            <span>Vitesse</span>
            <select id="speechSpeed">
              <option value="0.9" ${draft.speed === "0.9" ? "selected" : ""}>Lente</option>
              <option value="1" ${draft.speed === "1" ? "selected" : ""}>Normale</option>
              <option value="1.1" ${draft.speed === "1.1" ? "selected" : ""}>Rapide</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Type de médias</span>
            <select id="speechMode">
              <option value="video" ${draft.mode === "video" ? "selected" : ""}>Montage avec vidéos</option>
              <option value="image" ${draft.mode === "image" ? "selected" : ""}>Montage avec images</option>
            </select>
          </label>
          <label class="field">
            <span>Format final</span>
            <select id="speechAspectRatio">
              <option value="vertical" ${draft.aspectRatio === "vertical" ? "selected" : ""}>Vertical 9:16</option>
              <option value="horizontal" ${draft.aspectRatio === "horizontal" ? "selected" : ""}>Horizontal 16:9</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Durée finale max</span>
            <select id="speechDuration">${renderDurationOptions(draft.targetDuration)}</select>
          </label>
          <label class="field">
            <span>Source des médias</span>
            <select id="speechSourceMode">
              <option value="single" ${draft.mediaSourceMode === "single" ? "selected" : ""}>Bloc précis</option>
              <option value="multi" ${draft.mediaSourceMode === "multi" ? "selected" : ""}>Plusieurs blocs</option>
              <option value="ai" ${draft.mediaSourceMode === "ai" ? "selected" : ""}>IA choisit les blocs</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Mode de montage</span>
            <select id="speechMontageMode">
              <option value="auto" ${draft.montageMode === "auto" ? "selected" : ""}>Montage automatique</option>
              <option value="manual" ${draft.montageMode === "manual" ? "selected" : ""}>Montage manuel</option>
            </select>
          </label>
          <div></div>
        </div>

        <p class="small-note">${sourceModeHelp(draft.mediaSourceMode)}</p>
        <p class="small-note">${montageModeHelp(draft.montageMode)}</p>

        ${draft.mediaSourceMode === "single" ? `
          <label class="field">
            <span>Bloc choisi</span>
            <select id="speechPrimaryBlock">
              ${renderBlockSelectOptions(draft.primaryBlock)}
            </select>
          </label>
        ` : ""}

        ${draft.mediaSourceMode === "multi" ? `
          <div class="result-box">
            <div class="result-box-head"><h3>Blocs autorisés</h3></div>
            ${renderBlockCheckboxes("speechAllowedBlocks", draft.allowedBlocks || [])}
          </div>
        ` : ""}

        <div class="media-preview-card">
          <audio id="speechAudioPlayer" controls preload="metadata" ${state.temp.speechAudioUrl ? `src="${state.temp.speechAudioUrl}"` : ""}></audio>
          <p class="small-note">La voix générée devient l’audio principal du projet.</p>
        </div>

        <div class="result-box">
          <div class="result-box-head">
            <h3>Médias compatibles</h3>
            <button class="chip-btn" type="button" data-action="open-library" data-mode="speech" data-type="${draft.mode === "video" ? "video" : "image"}">Ouvrir ma bibliothèque</button>
          </div>
          ${renderSelectableMediaCards("speech", draft, selectedIds)}
        </div>

        <div class="result-box">
          <div class="result-box-head"><h3>Ordre du montage</h3></div>
          ${renderSelectedMediaOrder("speech", selectedIds)}
        </div>

        <div class="sticky-actions">
          <button id="speechGenerateCompleteBtn" class="secondary-btn" type="button">${state.temp.speechGenerating ? "Génération..." : "Générer contenu complet"}</button>
          <button class="primary-btn" type="submit">Créer la vidéo voix IA</button>
        </div>
      </form>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta réseaux sociaux</h3>
          <button class="chip-btn" type="button" data-action="copy-speech-general-meta">Copier</button>
        </div>
        <pre class="meta-output">${escapeHtml(state.temp.speechMetaGeneral || "Aucune métadonnée générée.")}</pre>
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta YouTube Shorts</h3>
          <button class="chip-btn" type="button" data-action="copy-speech-short-meta">Copier</button>
        </div>
        <pre class="meta-output">${escapeHtml(state.temp.speechMetaShorts || "Aucune métadonnée générée.")}</pre>
      </div>
    `
  );
}

function libraryTemplate() {
  return panel(
    "Bibliothèque médias",
    "Ajoute des images et vidéos, classe-les par bloc, l’app détecte leur orientation.",
    `
      <div class="stack-form">
        <div class="row-2">
          <label class="field">
            <span>Catégorie</span>
            <select id="libraryModeSelect">
              <option value="music" ${state.libraryMode === "music" ? "selected" : ""}>Médias musique</option>
              <option value="speech" ${state.libraryMode === "speech" ? "selected" : ""}>Médias voix</option>
            </select>
          </label>

          <label class="field">
            <span>Type de média</span>
            <select id="libraryTypeSelect">
              <option value="image" ${state.libraryType === "image" ? "selected" : ""}>Images</option>
              <option value="video" ${state.libraryType === "video" ? "selected" : ""}>Vidéos</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Bloc à l’ajout</span>
            <select id="libraryUploadBlock">
              ${renderBlockSelectOptions("Vrac")}
            </select>
          </label>

          <label class="field">
            <span>Filtre bloc</span>
            <select id="libraryBlockFilter">
              <option value="all" ${state.libraryBlockFilter === "all" ? "selected" : ""}>Tous les blocs</option>
              ${allMediaBlocks().map((block) => `<option value="${escapeHtml(block)}" ${state.libraryBlockFilter === block ? "selected" : ""}>${escapeHtml(block)}</option>`).join("")}
            </select>
          </label>
        </div>

        <div class="prompt-actions">
          <button type="button" data-action="create-custom-block">Créer un bloc</button>
        </div>

        <label class="field">
          <span>Ajouter des ${state.libraryType === "image" ? "images" : "vidéos"}</span>
          <input id="libraryFileInput" type="file" accept="${state.libraryType === "image" ? "image/*" : "video/*"}" multiple />
        </label>

        <div id="libraryMediaGrid" class="media-grid"></div>
      </div>
    `
  );
}

function projectsTemplate() {
  return panel(
    "Mes projets",
    "Reprendre, rendre, télécharger ou exporter.",
    `<div id="projectsList" class="card-list"></div>`
  );
}

function settingsTemplate() {
  const totalBytes = state.cache.media.reduce((sum, item) => sum + (item.size || item.blob?.size || 0), 0);

  return panel(
    "Paramètres",
    "Préférences, stockage et nettoyage.",
    `
      <div class="settings-group">
        <div class="setting-row">
          <div>
            <h3>Thème</h3>
            <p>Basculer entre sombre et clair.</p>
          </div>
          <button class="chip-btn" type="button" data-action="toggle-theme">Changer</button>
        </div>

        <div class="storage-box">
          <p><strong>Espace estimé utilisé :</strong> ${bytesToMB(totalBytes)}</p>
          <p><strong>Projets sauvegardés :</strong> ${state.cache.projects.length}</p>
          <p><strong>Médias stockés :</strong> ${state.cache.media.length}</p>
          <p><strong>Blocs actifs :</strong> ${allMediaBlocks().length}</p>
        </div>

        <button class="danger-btn" type="button" data-action="clear-cache">Nettoyer le cache local</button>
      </div>
    `
  );
}

function resultTemplate() {
  const project = state.cache.projects.find((item) => item.id === state.currentResultId);

  if (!project) {
    return panel("Résultat", "Aucun projet sélectionné.", `<div class="empty-state">Aucun résultat à afficher.</div>`);
  }

  const finalVideo = project.config?.finalVideoMediaId
    ? state.cache.media.find((m) => m.id === project.config.finalVideoMediaId)
    : null;

  const finalVideoUrl = finalVideo ? getMediaPreviewUrl(finalVideo) : "";
  const canRender = project.type === "speech" || project.type === "music";
  const renderStatus = project.config?.renderStatus || "draft";
  const isBusy = state.temp.renderBusyProjectId === project.id;

  return panel(
    `Résultat - ${projectTypeLabel(project.type)}`,
    "Projet local + rendu vidéo.",
    `
      ${finalVideo ? `
        <div class="media-preview-card">
          <video controls playsinline src="${finalVideoUrl}" style="width:100%;border-radius:14px;"></video>
        </div>
      ` : ""}

      <div class="result-box">
        <div class="result-box-head"><h3>Infos projet</h3></div>
        <p class="small-note">Type : ${projectTypeLabel(project.type)}</p>
        <p class="small-note">Format : ${aspectRatioLabel(project.config?.aspectRatio || "vertical")}</p>
        <p class="small-note">Source médias : ${sourceModeLabel(project.config?.mediaSourceMode || "single")}</p>
        <p class="small-note">Mode vidéo : ${montageModeLabel(project.config?.montageMode || "auto")}</p>
        <p class="small-note">Médias liés : ${(project.config?.selectedMediaIds || []).length}</p>
        <p class="small-note">Statut rendu : ${
          renderStatus === "processing" ? "En cours" :
          renderStatus === "done" ? "Vidéo prête" :
          renderStatus === "error" ? "Erreur" : "Non lancé"
        }</p>
      </div>

      ${project.type === "music" ? `
        <div class="result-box">
          <div class="result-box-head"><h3>Analyse Gemini</h3></div>
          ${renderMusicAnalysisHtml(project.config?.geminiAnalysis || null)}
        </div>

        <div class="result-box">
          <div class="result-box-head"><h3>Idée de clip Gemini</h3></div>
          ${renderMusicClipIdeasHtml(project.config?.geminiClipIdeas || null)}
        </div>

        <div class="result-box">
          <div class="result-box-head"><h3>Plan de montage IA</h3></div>
          ${renderMusicMontagePlanHtml(project.config?.montagePlan || null)}
        </div>
      ` : ""}

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta réseaux sociaux</h3>
          <button class="chip-btn" type="button" data-action="copy-main-meta">Copier</button>
        </div>
        <pre class="meta-output">${escapeHtml(project.mainMeta || "Aucune méta générée.")}</pre>
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta YouTube Shorts</h3>
          <button class="chip-btn" type="button" data-action="copy-short-meta">Copier</button>
        </div>
        <pre class="meta-output">${escapeHtml(project.shortMeta || "Aucune méta générée.")}</pre>
      </div>

      <div class="sticky-actions">
        ${canRender ? `
          <button class="secondary-btn" type="button" data-action="render-project-video" data-id="${project.id}" ${isBusy ? "disabled" : ""}>
            ${isBusy ? "Rendu..." : renderStatus === "done" ? "Refaire la vidéo" : "Créer la vidéo"}
          </button>
        ` : ""}
        ${finalVideo ? `<button class="secondary-btn" type="button" data-action="download-final-video" data-id="${project.id}">Télécharger la vidéo</button>` : ""}
        <button class="secondary-btn" type="button" data-action="export-project-json" data-id="${project.id}">Exporter le projet JSON</button>
      </div>
    `
  );
}

function soraTemplate() {
  const draft = state.temp.soraDraft;

  return panel(
    "Prompts vidéo",
    "Découpage audio + prompts IA horodatés.",
    `
      <form id="soraForm" class="stack-form">
        <label class="field">
          <span>Nom du projet prompts</span>
          <input id="soraProjectName" type="text" placeholder="Ex : Sora clip spatial" value="${escapeHtml(draft.name)}" />
        </label>

        <label class="field">
          <span>Audio</span>
          <input id="soraAudioInput" type="file" accept="audio/*" />
        </label>

        <div class="media-preview-card">
          <audio id="soraAudioPlayer" controls preload="metadata" ${state.temp.soraAudioUrl ? `src="${state.temp.soraAudioUrl}"` : ""}></audio>
          <div class="audio-meta">
            <p><strong>Début :</strong> <span id="soraStartLabel">${formatSeconds(Number(draft.start || 0))}</span></p>
            <p><strong>Fin :</strong> <span id="soraEndLabel">${formatSeconds(Number(draft.end || 0))}</span></p>
            <p><strong>Durée utile :</strong> <span id="soraRangeLabel">${formatSeconds(Math.max(0, Number(draft.end || 0) - Number(draft.start || 0)))}</span></p>
          </div>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Début</span>
            <input id="soraStartTime" type="number" min="0" step="0.1" value="${Number(draft.start || 0)}" />
          </label>

          <label class="field">
            <span>Fin</span>
            <input id="soraEndTime" type="number" min="0" step="0.1" value="${Number(draft.end || 0)}" />
          </label>
        </div>

        <div class="segmented-group">
          <p class="segment-title">Durée par prompt</p>
          <div class="segmented-buttons">
            <button class="segment-btn ${state.temp.soraDuration === 10 ? "active" : ""}" type="button" data-action="set-sora-duration" data-duration="10">10 secondes</button>
            <button class="segment-btn ${state.temp.soraDuration === 15 ? "active" : ""}" type="button" data-action="set-sora-duration" data-duration="15">15 secondes</button>
          </div>
        </div>

        <label class="field">
          <span>Style visuel</span>
          <select id="soraStyle">
            <option value="realisme" ${draft.style === "realisme" ? "selected" : ""}>Réalisme</option>
            <option value="sombre" ${draft.style === "sombre" ? "selected" : ""}>Sombre</option>
            <option value="cinematique" ${draft.style === "cinematique" ? "selected" : ""}>Cinématique</option>
            <option value="emotion" ${draft.style === "emotion" ? "selected" : ""}>Émotion</option>
            <option value="urbain" ${draft.style === "urbain" ? "selected" : ""}>Urbain</option>
            <option value="spatial" ${draft.style === "spatial" ? "selected" : ""}>Spatial</option>
          </select>
        </label>

        <div class="sticky-actions">
          <button class="primary-btn" type="submit">Générer les prompts</button>
        </div>
      </form>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Résultat</h3>
          <button class="chip-btn" type="button" data-action="copy-all-sora">Copier toute la série</button>
        </div>
        <div id="soraPromptResults" class="prompt-list"></div>
      </div>
    `
  );
}

/* =========================
   Render
========================= */
function render() {
  updateChrome();

  const routes = {
    profiles: profilesTemplate,
    adminLogin: adminLoginTemplate,
    dashboard: dashboardTemplate,
    musicProject: musicProjectTemplate,
    speechProject: speechProjectTemplate,
    library: libraryTemplate,
    projects: projectsTemplate,
    settings: settingsTemplate,
    result: resultTemplate,
    sora: soraTemplate
  };

  screen.innerHTML = (routes[state.route] || profilesTemplate)();
  bindCurrentScreen();
}

/* =========================
   Bind current screen
========================= */
function bindCurrentScreen() {
  if (state.route === "adminLogin") {
    document.getElementById("adminLoginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = safeText(document.getElementById("adminPasswordInput")?.value);
      if (password !== state.adminPassword) {
        showToast("Mot de passe incorrect.");
        return;
      }
      await enterProfile("admin");
    });
  }

  if (state.route === "musicProject") bindMusicProject();
  if (state.route === "speechProject") bindSpeechProject();
  if (state.route === "library") bindLibrary();
  if (state.route === "projects") renderProjectsList();
  if (state.route === "sora") {
    bindSora();
    renderSoraResults(state.temp.lastSoraPrompts);
  }
}

/* =========================
   Music project logic
========================= */
const debouncedSaveMusicDraft = debounce(() => saveMusicDraft().catch(console.error), 400);

function bindMusicProject() {
  const nameInput = document.getElementById("musicProjectName");
  const audioInput = document.getElementById("musicAudioInput");
  const audioPlayer = document.getElementById("musicAudioPlayer");
  const startInput = document.getElementById("musicStartTime");
  const endInput = document.getElementById("musicEndTime");
  const durationSelect = document.getElementById("musicDuration");
  const modeSelect = document.getElementById("musicMode");
  const styleSelect = document.getElementById("musicStyle");
  const montageModeSelect = document.getElementById("musicMontageMode");
  const aspectRatioSelect = document.getElementById("musicAspectRatio");
  const sourceModeSelect = document.getElementById("musicSourceMode");
  const primaryBlockSelect = document.getElementById("musicPrimaryBlock");
  const analyzeBtn = document.getElementById("musicAnalyzeBtn");
  const ideasBtn = document.getElementById("musicIdeasBtn");
  const pilotBtn = document.getElementById("musicPilotBtn");
  const form = document.getElementById("musicProjectForm");

  const syncDraft = () => {
    const sourceMode = sourceModeSelect?.value || "single";
    const primaryBlock = normalizeBlock(primaryBlockSelect?.value || state.temp.musicDraft.primaryBlock || "Vrac");
    const allowedBlocks = [...document.querySelectorAll('input[name="musicAllowedBlocks"]:checked')].map((el) => normalizeBlock(el.value));

    state.temp.musicDraft = {
      ...state.temp.musicDraft,
      name: nameInput?.value || "",
      start: Number(startInput?.value || 0),
      end: Number(endInput?.value || 0),
      targetDuration: durationSelect?.value || "30",
      style: styleSelect?.value || "social",
      mode: modeSelect?.value || "video",
      montageMode: montageModeSelect?.value || "auto",
      aspectRatio: aspectRatioSelect?.value || "vertical",
      mediaSourceMode: sourceMode,
      primaryBlock,
      allowedBlocks: sourceMode === "multi" ? (allowedBlocks.length ? allowedBlocks : [primaryBlock]) : [primaryBlock]
    };

    debouncedSaveMusicDraft();
  };

  const refreshLabels = () => {
    const duration = state.temp.musicAudioDuration || 0;
    const start = clamp(Number(startInput.value || 0), 0, duration);
    const end = clamp(Number(endInput.value || 0), 0, duration);
    const actualEnd = Math.max(start, end);

    document.getElementById("musicStartLabel").textContent = formatSeconds(start);
    document.getElementById("musicEndLabel").textContent = formatSeconds(actualEnd);
    document.getElementById("musicRangeLabel").textContent = formatSeconds(actualEnd - start);
    syncDraft();
  };

  [nameInput, durationSelect, styleSelect, montageModeSelect, aspectRatioSelect].forEach((el) => {
    el?.addEventListener("input", syncDraft);
    el?.addEventListener("change", syncDraft);
  });

  [modeSelect, sourceModeSelect].forEach((el) => {
    el?.addEventListener("change", () => {
      syncDraft();
      render();
    });
  });

  primaryBlockSelect?.addEventListener("change", () => {
    syncDraft();
    render();
  });

  document.querySelectorAll('input[name="musicAllowedBlocks"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncDraft();
      render();
    });
  });

  audioInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] || null;
    resetObjectUrl(state.temp.musicAudioUrl);
    state.temp.musicAudioFile = file;
    state.temp.musicAnalysis = null;
    state.temp.musicClipIdeas = null;
    state.temp.musicMontagePlan = null;
    state.temp.musicMetaGeneral = "";
    state.temp.musicMetaShorts = "";

    if (!file) {
      state.temp.musicAudioDuration = 0;
      state.temp.musicAudioUrl = "";
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
      startInput.value = 0;
      endInput.value = 0;
      refreshLabels();
      await saveMusicDraft();
      return;
    }

    const url = URL.createObjectURL(file);
    state.temp.musicAudioUrl = url;
    audioPlayer.src = url;
    audioPlayer.onloadedmetadata = async () => {
      state.temp.musicAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      startInput.value = 0;
      endInput.value = state.temp.musicAudioDuration.toFixed(1);
      refreshLabels();
      await saveMusicDraft();
      render();
    };
  });

  if (audioPlayer?.src) {
    audioPlayer.onloadedmetadata = () => {
      state.temp.musicAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      refreshLabels();
    };
  }

  startInput?.addEventListener("input", refreshLabels);
  endInput?.addEventListener("input", refreshLabels);

  analyzeBtn?.addEventListener("click", async () => {
    syncDraft();
    await analyzeMusicWithGemini();
  });

  ideasBtn?.addEventListener("click", async () => {
    syncDraft();
    await generateMusicClipIdeas();
  });

  pilotBtn?.addEventListener("click", async () => {
    syncDraft();
    await pilotMusicProjectWithAi();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncDraft();
    await createMusicProject();
  });
}

async function syncMusicAiToExistingProject() {
  const projectId = state.temp.musicDraft.id;
  if (!projectId) return;

  const project = state.cache.projects.find((item) => item.id === projectId);
  if (!project) return;

  await projectPut({
    ...project,
    updatedAt: nowISO(),
    mainMeta: state.temp.musicMetaGeneral || project.mainMeta || "",
    shortMeta: state.temp.musicMetaShorts || project.shortMeta || "",
    config: {
      ...project.config,
      selectedMediaIds: state.temp.musicDraft.selectedMediaIds || [],
      geminiAnalysis: state.temp.musicAnalysis || null,
      geminiClipIdeas: state.temp.musicClipIdeas || null,
      montagePlan: state.temp.musicMontagePlan || null
    }
  });

  await hydrateCache();
}

async function analyzeMusicWithGemini() {
  const audioFile = state.temp.musicAudioFile;
  const draft = state.temp.musicDraft;
  const title = safeText(draft.name) || "Projet musique";

  if (!audioFile) {
    showToast("Ajoute une musique avant l’analyse.");
    return;
  }

  state.temp.musicAnalyzing = true;
  render();

  try {
    const formData = new FormData();
    formData.append("audio", audioFile, audioFile.name || `${title}.mp3`);
    formData.append("title", title);
    formData.append("context", buildMusicGeminiContext(draft));

    const result = await postGeminiForm("/api/gemini/analyze-audio", formData);

    state.temp.musicAnalysis = result.analysis || { raw: result.raw || "Analyse vide." };
    await saveMusicDraft();
    await syncMusicAiToExistingProject();
    render();
    showToast("Analyse Gemini terminée.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Erreur pendant l’analyse Gemini.");
  } finally {
    state.temp.musicAnalyzing = false;
    render();
  }
}

async function generateMusicClipIdeas() {
  const draft = state.temp.musicDraft;
  const title = safeText(draft.name) || "Projet musique";

  if (!state.temp.musicAnalysis) {
    showToast("Lance d’abord l’analyse Gemini.");
    return;
  }

  state.temp.musicIdeasLoading = true;
  render();

  try {
    const result = await postGeminiJson("/api/gemini/clip-ideas", {
      title,
      analysis: state.temp.musicAnalysis,
      context: buildMusicGeminiContext(draft)
    });

    state.temp.musicClipIdeas = result.result || { raw: result.raw || "Idée vide." };
    await saveMusicDraft();
    await syncMusicAiToExistingProject();
    render();
    showToast("Idée de clip créée.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Erreur pendant la création de l’idée.");
  } finally {
    state.temp.musicIdeasLoading = false;
    render();
  }
}

async function pilotMusicProjectWithAi() {
  const draft = state.temp.musicDraft;
  const title = safeText(draft.name) || "Projet musique";

  if (!state.temp.musicAudioFile) {
    showToast("Ajoute une musique avant le pilotage IA.");
    return;
  }

  state.temp.musicPilotLoading = true;
  render();

  try {
    if (!state.temp.musicAnalysis) {
      await analyzeMusicWithGemini();
    }

    if (!state.temp.musicClipIdeas) {
      await generateMusicClipIdeas();
    }

    const candidates = mapMediaCandidatesForAi("music", draft);
    if (!candidates.length) {
      throw new Error("Aucun média compatible pour le pilotage IA.");
    }

    const selection = await postGeminiJson("/api/gemini/select-media", {
      title,
      targetDurationSec: Number(draft.targetDuration || 30),
      aspectRatio: draft.aspectRatio,
      mediaSourceMode: draft.mediaSourceMode,
      allowedBlocks: getDraftBlocks(draft),
      analysis: state.temp.musicAnalysis,
      clipIdeas: state.temp.musicClipIdeas,
      candidates
    });

    let selectedMediaIds = Array.isArray(selection.selectedIds) && selection.selectedIds.length
      ? selection.selectedIds
      : candidates.slice(0, 6).map((item) => item.id);

    const selectedCandidates = candidates.filter((item) => selectedMediaIds.includes(item.id));

    const planRes = await postJson("/api/montage/plan", {
      projectType: "music",
      title,
      aspectRatio: draft.aspectRatio,
      style: draft.style,
      durationSec: Number(draft.targetDuration || 30),
      analysis: state.temp.musicAnalysis,
      clipIdeas: state.temp.musicClipIdeas,
      candidates: selectedCandidates
    });

    const plan = planRes.plan || null;
    state.temp.musicMontagePlan = plan;

    if (Array.isArray(plan?.selectedMediaIds) && plan.selectedMediaIds.length) {
      selectedMediaIds = plan.selectedMediaIds;
    }

    state.temp.musicDraft.selectedMediaIds = selectedMediaIds;
    state.temp.musicMetaGeneral = safeText(planRes.general || "");
    state.temp.musicMetaShorts = safeText(planRes.shorts || "").slice(0, 100);

    await saveMusicDraft();
    await syncMusicAiToExistingProject();
    render();
    showToast("Pilotage IA terminé.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Erreur pendant le pilotage IA.");
  } finally {
    state.temp.musicPilotLoading = false;
    render();
  }
}

async function createMusicProject() {
  const draft = state.temp.musicDraft;
  const name = safeText(draft.name) || `Montage musique ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temp.musicAudioFile;

  if (!audioFile) {
    showToast("Ajoute une musique principale.");
    return;
  }

  const duration = state.temp.musicAudioDuration || 0;
  const start = clamp(Number(draft.start || 0), 0, duration);
  const end = clamp(Number(draft.end || 0), 0, duration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const audioRecord = {
    id: uid("audio"),
    owner: state.profile,
    bucket: "project-audio",
    mediaType: "audio",
    fileName: audioFile.name || `${name}.mp3`,
    mimeType: audioFile.type || "audio/*",
    size: audioFile.size || 0,
    createdAt: nowISO(),
    blob: audioFile
  };
  await mediaPut(audioRecord);

  const project = {
    id: draft.id || uid("project"),
    owner: state.profile,
    type: "music",
    name,
    createdAt: draft.id ? (state.cache.projects.find((p) => p.id === draft.id)?.createdAt || nowISO()) : nowISO(),
    updatedAt: nowISO(),
    status: "Projet prêt",
    config: {
      audioMediaId: audioRecord.id,
      audioStart: start,
      audioEnd: end,
      targetDuration: draft.targetDuration,
      style: draft.style,
      mode: draft.mode,
      montageMode: draft.montageMode,
      aspectRatio: draft.aspectRatio,
      mediaSourceMode: draft.mediaSourceMode,
      primaryBlock: draft.primaryBlock,
      allowedBlocks: draft.allowedBlocks || [],
      selectedMediaIds: draft.selectedMediaIds || [],
      geminiAnalysis: state.temp.musicAnalysis || null,
      geminiClipIdeas: state.temp.musicClipIdeas || null,
      montagePlan: state.temp.musicMontagePlan || null,
      renderStatus: "draft",
      finalVideoMediaId: null
    },
    mainMeta: state.temp.musicMetaGeneral || `${name}\nMontage ${draft.mode === "video" ? "vidéo" : "image"} ${draft.style}, format ${aspectRatioLabel(draft.aspectRatio)}.\n#montageia #${draft.style} #clip #mobile #video`,
    shortMeta: state.temp.musicMetaShorts || `${name}\n#montageia #${draft.style}`.slice(0, 99)
  };

  await projectPut(project);
  await hydrateCache();

  state.temp.musicDraft.id = project.id;
  await saveMusicDraft();

  state.currentResultId = project.id;
  state.route = "result";
  render();
  showToast("Projet musique créé.");
}

async function loadMusicProjectIntoDraft(project) {
  state.temp.musicDraft = {
    id: project.id,
    name: project.name || "",
    start: project.config?.audioStart || 0,
    end: project.config?.audioEnd || 0,
    targetDuration: project.config?.targetDuration || "30",
    style: project.config?.style || "social",
    mode: project.config?.mode || "video",
    montageMode: project.config?.montageMode || "auto",
    aspectRatio: project.config?.aspectRatio || "vertical",
    mediaSourceMode: project.config?.mediaSourceMode || "single",
    primaryBlock: normalizeBlock(project.config?.primaryBlock || "Vrac"),
    allowedBlocks: Array.isArray(project.config?.allowedBlocks) ? project.config.allowedBlocks : ["Vrac"],
    selectedMediaIds: project.config?.selectedMediaIds || []
  };

  state.temp.musicAnalysis = project.config?.geminiAnalysis || null;
  state.temp.musicClipIdeas = project.config?.geminiClipIdeas || null;
  state.temp.musicMontagePlan = project.config?.montagePlan || null;
  state.temp.musicMetaGeneral = project.mainMeta || "";
  state.temp.musicMetaShorts = project.shortMeta || "";

  const audioMedia = await mediaGetById(project.config?.audioMediaId);
  resetObjectUrl(state.temp.musicAudioUrl);

  if (audioMedia?.blob) {
    state.temp.musicAudioFile = audioMedia.blob;
    state.temp.musicAudioUrl = URL.createObjectURL(audioMedia.blob);
  } else {
    state.temp.musicAudioFile = null;
    state.temp.musicAudioUrl = "";
  }

  await saveMusicDraft();
}

/* =========================
   Speech project logic
========================= */
const debouncedSaveSpeechDraft = debounce(() => saveSpeechDraft().catch(console.error), 400);

function bindSpeechProject() {
  const nameInput = document.getElementById("speechProjectName");
  const textInput = document.getElementById("speechText");
  const familySelect = document.getElementById("speechVoiceFamily");
  const styleSelect = document.getElementById("speechVoiceStyle");
  const toneSelect = document.getElementById("speechTone");
  const speedSelect = document.getElementById("speechSpeed");
  const modeSelect = document.getElementById("speechMode");
  const montageModeSelect = document.getElementById("speechMontageMode");
  const aspectRatioSelect = document.getElementById("speechAspectRatio");
  const durationSelect = document.getElementById("speechDuration");
  const sourceModeSelect = document.getElementById("speechSourceMode");
  const primaryBlockSelect = document.getElementById("speechPrimaryBlock");
  const generateBtn = document.getElementById("speechGenerateCompleteBtn");
  const form = document.getElementById("speechProjectForm");

  const syncDraft = () => {
    const family = familySelect?.value || "naturel";
    const sourceMode = sourceModeSelect?.value || "single";
    const primaryBlock = normalizeBlock(primaryBlockSelect?.value || state.temp.speechDraft.primaryBlock || "Moi");
    const allowedBlocks = [...document.querySelectorAll('input[name="speechAllowedBlocks"]:checked')].map((el) => normalizeBlock(el.value));

    state.temp.speechDraft = {
      ...state.temp.speechDraft,
      name: nameInput?.value || "",
      text: textInput?.value || "",
      voiceFamily: family,
      voiceStyle: ensureStyleInFamily(family, styleSelect?.value || state.temp.speechDraft.voiceStyle),
      tone: toneSelect?.value || "normal",
      speed: speedSelect?.value || "1",
      mode: modeSelect?.value || "video",
      montageMode: montageModeSelect?.value || "auto",
      aspectRatio: aspectRatioSelect?.value || "vertical",
      targetDuration: durationSelect?.value || "30",
      mediaSourceMode: sourceMode,
      primaryBlock,
      allowedBlocks: sourceMode === "multi" ? (allowedBlocks.length ? allowedBlocks : [primaryBlock]) : [primaryBlock]
    };

    debouncedSaveSpeechDraft();
  };

  familySelect?.addEventListener("change", () => {
    const family = familySelect.value || "naturel";
    state.temp.speechDraft.voiceFamily = family;
    state.temp.speechDraft.voiceStyle = getStylesForFamily(family)[0].id;
    syncDraft();
    render();
  });

  [nameInput, textInput, styleSelect, toneSelect, speedSelect, montageModeSelect, aspectRatioSelect, durationSelect].forEach((el) => {
    el?.addEventListener("input", syncDraft);
    el?.addEventListener("change", syncDraft);
  });

  [modeSelect, sourceModeSelect].forEach((el) => {
    el?.addEventListener("change", () => {
      syncDraft();
      render();
    });
  });

  primaryBlockSelect?.addEventListener("change", () => {
    syncDraft();
    render();
  });

  document.querySelectorAll('input[name="speechAllowedBlocks"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncDraft();
      render();
    });
  });

  generateBtn?.addEventListener("click", async () => {
    syncDraft();
    await generateSpeechContentComplete();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncDraft();
    await createSpeechProject();
  });
}

async function generateSpeechContentComplete() {
  const draft = state.temp.speechDraft;
  const title = safeText(draft.name) || "Voix IA";
  const text = safeText(draft.text);

  if (!text) {
    showToast("Colle un texte avant de générer.");
    return;
  }

  state.temp.speechGenerating = true;
  render();

  try {
    const [metaResult, speechResponse] = await Promise.all([
      postJson("/api/meta/generate", {
        projectType: "speech",
        title,
        style: draft.tone,
        mode: draft.mode,
        tone: draft.tone,
        voiceFamily: draft.voiceFamily,
        voiceStyle: draft.voiceStyle
      }),
      fetch(`${BACKEND_BASE_URL}/api/speech/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceFamily: draft.voiceFamily,
          voiceStyle: draft.voiceStyle,
          tone: draft.tone,
          speed: draft.speed
        })
      })
    ]);

    if (!speechResponse.ok) {
      let errorMessage = "Impossible de générer la voix.";
      try {
        const errorData = await speechResponse.json();
        errorMessage = errorData?.error || errorMessage;
      } catch {}
      throw new Error(errorMessage);
    }

    const audioBlob = await speechResponse.blob();

    resetObjectUrl(state.temp.speechAudioUrl);
    state.temp.speechAudioBlob = audioBlob;
    state.temp.speechAudioUrl = URL.createObjectURL(audioBlob);
    state.temp.speechMetaGeneral = safeText(metaResult.general || "");
    state.temp.speechMetaShorts = safeText(metaResult.shorts || "").slice(0, 99);

    await saveSpeechDraft();
    render();
    showToast("Voix et métadonnées générées.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Erreur pendant la génération.");
  } finally {
    state.temp.speechGenerating = false;
    render();
  }
}

async function createSpeechProject() {
  const draft = state.temp.speechDraft;
  const name = safeText(draft.name) || `Voix IA ${new Date().toLocaleDateString("fr-FR")}`;
  const textValue = safeText(draft.text);

  if (!textValue) {
    showToast("Colle un texte.");
    return;
  }

  if (!state.temp.speechAudioBlob) {
    showToast("Commence par générer le contenu complet.");
    return;
  }

  const audioRecord = {
    id: uid("speech_audio"),
    owner: state.profile,
    bucket: "project-audio",
    mediaType: "audio",
    fileName: `${name.replace(/[^\w-]/g, "_")}_voice.mp3`,
    mimeType: "audio/mpeg",
    size: state.temp.speechAudioBlob.size || 0,
    createdAt: nowISO(),
    blob: state.temp.speechAudioBlob
  };
  await mediaPut(audioRecord);

  const project = {
    id: draft.id || uid("project"),
    owner: state.profile,
    type: "speech",
    name,
    createdAt: draft.id ? (state.cache.projects.find((p) => p.id === draft.id)?.createdAt || nowISO()) : nowISO(),
    updatedAt: nowISO(),
    status: "Projet prêt",
    config: {
      text: textValue,
      voiceFamily: draft.voiceFamily,
      voiceStyle: draft.voiceStyle,
      tone: draft.tone,
      speed: draft.speed,
      mode: draft.mode,
      montageMode: draft.montageMode,
      aspectRatio: draft.aspectRatio,
      targetDuration: draft.targetDuration,
      mediaSourceMode: draft.mediaSourceMode,
      primaryBlock: draft.primaryBlock,
      allowedBlocks: draft.allowedBlocks || [],
      generatedAudioMediaId: audioRecord.id,
      selectedMediaIds: draft.selectedMediaIds || [],
      renderStatus: "draft",
      finalVideoMediaId: null
    },
    mainMeta: state.temp.speechMetaGeneral || `${name}\nVoix ${findVoiceLabel(draft.voiceStyle)}, format ${aspectRatioLabel(draft.aspectRatio)}.\n#speech #narration #montageia #video #mobile`,
    shortMeta: state.temp.speechMetaShorts || `${name}\n#speech #montageia`.slice(0, 99)
  };

  await projectPut(project);
  await hydrateCache();

  state.temp.speechDraft.id = project.id;
  await saveSpeechDraft();

  state.currentResultId = project.id;
  state.route = "result";
  render();
  showToast("Projet voix IA créé.");
}

async function loadSpeechProjectIntoDraft(project) {
  state.temp.speechDraft = {
    id: project.id,
    name: project.name || "",
    text: project.config?.text || "",
    voiceFamily: project.config?.voiceFamily || "naturel",
    voiceStyle: ensureStyleInFamily(
      project.config?.voiceFamily || "naturel",
      project.config?.voiceStyle || "masculin-naturel"
    ),
    tone: project.config?.tone || "normal",
    speed: project.config?.speed || "1",
    mode: project.config?.mode || "video",
    montageMode: project.config?.montageMode || "auto",
    aspectRatio: project.config?.aspectRatio || "vertical",
    targetDuration: project.config?.targetDuration || "30",
    mediaSourceMode: project.config?.mediaSourceMode || "single",
    primaryBlock: normalizeBlock(project.config?.primaryBlock || "Moi"),
    allowedBlocks: Array.isArray(project.config?.allowedBlocks) ? project.config.allowedBlocks : ["Moi"],
    selectedMediaIds: project.config?.selectedMediaIds || []
  };

  state.temp.speechMetaGeneral = project.mainMeta || "";
  state.temp.speechMetaShorts = project.shortMeta || "";

  const audioMedia = await mediaGetById(project.config?.generatedAudioMediaId);
  resetObjectUrl(state.temp.speechAudioUrl);

  if (audioMedia?.blob) {
    state.temp.speechAudioBlob = audioMedia.blob;
    state.temp.speechAudioUrl = URL.createObjectURL(audioMedia.blob);
  } else {
    state.temp.speechAudioBlob = null;
    state.temp.speechAudioUrl = "";
  }

  await saveSpeechDraft();
}

/* =========================
   Sora
========================= */
const debouncedSaveSoraDraft = debounce(() => saveSoraDraft().catch(console.error), 400);

function bindSora() {
  const nameInput = document.getElementById("soraProjectName");
  const audioInput = document.getElementById("soraAudioInput");
  const audioPlayer = document.getElementById("soraAudioPlayer");
  const startInput = document.getElementById("soraStartTime");
  const endInput = document.getElementById("soraEndTime");
  const styleSelect = document.getElementById("soraStyle");
  const form = document.getElementById("soraForm");

  const syncDraft = () => {
    state.temp.soraDraft = {
      ...state.temp.soraDraft,
      name: nameInput?.value || "",
      start: Number(startInput?.value || 0),
      end: Number(endInput?.value || 0),
      style: styleSelect?.value || "realisme"
    };
    debouncedSaveSoraDraft();
  };

  const refreshLabels = () => {
    const duration = state.temp.soraAudioDuration || 0;
    const start = clamp(Number(startInput.value || 0), 0, duration);
    const end = clamp(Number(endInput.value || 0), 0, duration);
    const actualEnd = Math.max(start, end);

    document.getElementById("soraStartLabel").textContent = formatSeconds(start);
    document.getElementById("soraEndLabel").textContent = formatSeconds(actualEnd);
    document.getElementById("soraRangeLabel").textContent = formatSeconds(actualEnd - start);
    syncDraft();
  };

  [nameInput, startInput, endInput, styleSelect].forEach((el) => {
    el?.addEventListener("input", syncDraft);
    el?.addEventListener("change", syncDraft);
  });

  audioInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] || null;
    resetObjectUrl(state.temp.soraAudioUrl);
    state.temp.soraAudioFile = file;

    if (!file) {
      state.temp.soraAudioDuration = 0;
      state.temp.soraAudioUrl = "";
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
      startInput.value = 0;
      endInput.value = 0;
      refreshLabels();
      await saveSoraDraft();
      return;
    }

    const url = URL.createObjectURL(file);
    state.temp.soraAudioUrl = url;
    audioPlayer.src = url;
    audioPlayer.onloadedmetadata = async () => {
      state.temp.soraAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      if (!Number(endInput.value)) endInput.value = state.temp.soraAudioDuration.toFixed(1);
      refreshLabels();
      await saveSoraDraft();
    };
  });

  if (audioPlayer?.src) {
    audioPlayer.onloadedmetadata = () => {
      state.temp.soraAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      refreshLabels();
    };
  }

  startInput?.addEventListener("input", refreshLabels);
  endInput?.addEventListener("input", refreshLabels);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncDraft();
    await createSoraProject();
  });
}

async function createSoraProject() {
  const draft = state.temp.soraDraft;
  const name = safeText(draft.name) || `Prompts vidéo ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temp.soraAudioFile;
  const totalDuration = state.temp.soraAudioDuration || 0;

  if (!audioFile) {
    showToast("Ajoute un audio.");
    return;
  }

  const start = clamp(Number(draft.start || 0), 0, totalDuration);
  const end = clamp(Number(draft.end || 0), 0, totalDuration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const audioRecord = {
    id: uid("sora_audio"),
    owner: state.profile,
    bucket: "project-audio",
    mediaType: "audio",
    fileName: audioFile.name || `${name}.mp3`,
    mimeType: audioFile.type || "audio/*",
    size: audioFile.size || 0,
    createdAt: nowISO(),
    blob: audioFile
  };
  await mediaPut(audioRecord);

  const result = await postJson("/api/sora/prompts", {
    title: name,
    start,
    end,
    segmentDuration: state.temp.soraDuration,
    style: draft.style || "realisme",
    universe: "",
    notes: "",
    lyricsExcerpt: ""
  });

  const prompts = Array.isArray(result.prompts) ? result.prompts : [];
  state.temp.lastSoraPrompts = prompts;

  const project = {
    id: draft.id || uid("project"),
    owner: state.profile,
    type: "sora",
    name,
    createdAt: draft.id ? (state.cache.projects.find((p) => p.id === draft.id)?.createdAt || nowISO()) : nowISO(),
    updatedAt: nowISO(),
    status: "Prompts prêts",
    config: {
      audioMediaId: audioRecord.id,
      start,
      end,
      segmentDuration: state.temp.soraDuration,
      style: draft.style || "realisme"
    },
    prompts,
    mainMeta: "",
    shortMeta: ""
  };

  await projectPut(project);
  await hydrateCache();

  state.temp.soraDraft.id = project.id;
  await saveSoraDraft();

  renderSoraResults(prompts);
  showToast(`${prompts.length} prompts générés.`);
}

function renderSoraResults(prompts) {
  const container = document.getElementById("soraPromptResults");
  if (!container) return;

  container.innerHTML = "";

  if (!prompts?.length) {
    container.innerHTML = `<div class="empty-state">Aucun prompt généré.</div>`;
    return;
  }

  prompts.forEach((item) => {
    const article = document.createElement("article");
    article.className = "prompt-card";
    article.innerHTML = `
      <h4>Prompt ${item.index}</h4>
      <div class="prompt-time">De ${formatSeconds(item.start)} à ${formatSeconds(item.end)}</div>
      <div class="prompt-text">${escapeHtml(item.prompt || item.text || "").replace(/\n/g, "<br>")}</div>
      <div class="prompt-actions">
        <button type="button" data-action="copy-sora-prompt" data-text="${encodeURIComponent(item.prompt || item.text || "")}">Copier ce prompt</button>
      </div>
    `;
    container.appendChild(article);
  });
}

async function loadSoraProjectIntoDraft(project) {
  state.temp.soraDraft = {
    id: project.id,
    name: project.name || "",
    start: project.config?.start || 0,
    end: project.config?.end || 0,
    style: project.config?.style || "realisme"
  };
  state.temp.soraDuration = project.config?.segmentDuration || 10;
  state.temp.lastSoraPrompts = project.prompts || [];

  const audioMedia = await mediaGetById(project.config?.audioMediaId);
  resetObjectUrl(state.temp.soraAudioUrl);

  if (audioMedia?.blob) {
    state.temp.soraAudioFile = audioMedia.blob;
    state.temp.soraAudioUrl = URL.createObjectURL(audioMedia.blob);
  } else {
    state.temp.soraAudioFile = null;
    state.temp.soraAudioUrl = "";
  }

  await saveSoraDraft();
}

/* =========================
   Library
========================= */
function bindLibrary() {
  document.getElementById("libraryModeSelect")?.addEventListener("change", (event) => {
    state.libraryMode = event.target.value;
    render();
  });

  document.getElementById("libraryTypeSelect")?.addEventListener("change", (event) => {
    state.libraryType = event.target.value;
    render();
  });

  document.getElementById("libraryBlockFilter")?.addEventListener("change", (event) => {
    state.libraryBlockFilter = event.target.value;
    render();
  });

  document.getElementById("libraryFileInput")?.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;

    const bucket = getBucketForProject(state.libraryMode, state.libraryType === "video" ? "video" : "image");
    const chosenBlock = normalizeBlock(document.getElementById("libraryUploadBlock")?.value || "Vrac");

    showToast("Analyse des médias en cours...");

    for (const file of files) {
      const orientation = await detectFileOrientation(file, state.libraryType);

      await mediaPut({
        id: uid("media"),
        owner: state.profile,
        bucket,
        mediaType: state.libraryType,
        fileName: file.name,
        mimeType: file.type || "*/*",
        size: file.size || 0,
        createdAt: nowISO(),
        block: chosenBlock,
        orientation,
        tags: [],
        blob: file
      });
    }

    await hydrateCache();
    render();
    showToast("Médias ajoutés.");
  });

  renderLibraryGrid();
}

function renderLibraryGrid() {
  const grid = document.getElementById("libraryMediaGrid");
  if (!grid) return;

  const bucket = getBucketForProject(state.libraryMode, state.libraryType === "video" ? "video" : "image");
  let items = state.cache.media.filter((item) => item.bucket === bucket);

  if (state.libraryBlockFilter !== "all") {
    items = items.filter((item) => normalizeBlock(item.block) === state.libraryBlockFilter);
  }

  grid.innerHTML = "";

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">Aucun média dans cette section.</div>`;
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "media-card";
    article.innerHTML = `
      <button type="button" data-action="open-media-viewer" data-id="${item.id}" style="all:unset;display:block;width:100%;cursor:pointer;">
        ${item.mediaType === "image"
          ? `<img src="${getMediaPreviewUrl(item)}" alt="${escapeHtml(item.fileName)}" />`
          : `<video src="${getMediaPreviewUrl(item)}" muted playsinline></video>`
        }
      </button>
      <div class="media-card-label">${escapeHtml(item.fileName)}</div>
      <div class="small-note">${escapeHtml(item.block || "Vrac")} • ${escapeHtml(mediaOrientationLabel(item.orientation || "unknown"))}</div>
      <div class="prompt-actions">
        <button type="button" data-action="change-media-block" data-id="${item.id}">Changer bloc</button>
        <button type="button" data-action="delete-media" data-id="${item.id}">Supprimer</button>
      </div>
    `;
    grid.appendChild(article);
  });
}

/* =========================
   Render final video
========================= */
async function renderProjectVideo(projectId) {
  const project = state.cache.projects.find((p) => p.id === projectId);
  if (!project) {
    showToast("Projet introuvable.");
    return;
  }

  if (!(project.type === "speech" || project.type === "music")) {
    showToast("Ce projet ne peut pas générer de vidéo.");
    return;
  }

  const audioMediaId = project.type === "speech"
    ? project.config?.generatedAudioMediaId
    : project.config?.audioMediaId;

  const audioMedia = await mediaGetById(audioMediaId);
  if (!audioMedia?.blob) {
    showToast("Audio principal introuvable.");
    return;
  }

  const linkedMedia = getSelectedOrFallbackMedia(project);
  if (!linkedMedia.length) {
    showToast("Ajoute au moins un média au projet.");
    return;
  }

  let targetDurationSec = 0;
  let audioStartSec = 0;
  let audioEndSec = 0;

  if (project.type === "speech") {
    const speechTotal = await getBlobDuration(audioMedia.blob, "audio");
    const maxDuration = Number(project.config?.targetDuration || 30);
    targetDurationSec = Math.min(speechTotal || 0, maxDuration || 30);
    audioStartSec = 0;
    audioEndSec = targetDurationSec;
  } else {
    const configuredDuration = Math.max(
      0,
      Number(project.config?.audioEnd || 0) - Number(project.config?.audioStart || 0)
    );
    const maxDuration = Number(project.config?.targetDuration || 30);
    targetDurationSec = Math.min(configuredDuration, maxDuration || 30);
    audioStartSec = Number(project.config?.audioStart || 0);
    audioEndSec = audioStartSec + targetDurationSec;
  }

  if (!targetDurationSec || targetDurationSec <= 0) {
    showToast("Durée audio invalide.");
    return;
  }

  state.temp.renderBusyProjectId = project.id;
  render();

  try {
    await projectPut({
      ...project,
      updatedAt: nowISO(),
      status: "Rendu en cours",
      config: {
        ...project.config,
        renderStatus: "processing"
      }
    });
    await hydrateCache();
    render();

    const mediaManifest = linkedMedia.map((media) => ({
      id: media.id,
      fileName: media.fileName,
      mediaType: media.mediaType
    }));

    const montagePlan = project.config?.montagePlan || null;

    const formData = new FormData();
    formData.append("projectType", project.type);
    formData.append("mode", project.config?.mode || "video");
    formData.append("aspectRatio", project.config?.aspectRatio || "vertical");
    formData.append("audioStartSec", String(audioStartSec));
    formData.append("audioEndSec", String(audioEndSec));
    formData.append("targetDurationSec", String(targetDurationSec));
    formData.append("title", project.name);
    formData.append("transitionStyle", montagePlan?.transitionStyle || "fade");
    formData.append("effectStyle", montagePlan?.effectStyle || "clean");
    formData.append("timelineJson", JSON.stringify(montagePlan?.timeline || []));
    formData.append("mediaManifestJson", JSON.stringify(mediaManifest));

    formData.append(
      "audio",
      audioMedia.blob,
      audioMedia.fileName || `${project.name.replace(/[^\w-]/g, "_")}.mp3`
    );

    linkedMedia.forEach((media, index) => {
      const ext = media.mediaType === "image" ? ".jpg" : ".mp4";
      formData.append("media", media.blob, media.fileName || `media_${index + 1}${ext}`);
    });

    const response = await fetch(`${BACKEND_BASE_URL}/api/render/video`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      let errorMessage = "Impossible de créer la vidéo.";
      try {
        const errorData = await response.json();
        errorMessage = errorData?.error || errorMessage;
      } catch {}
      throw new Error(errorMessage);
    }

    const videoBlob = await response.blob();

    const renderedMedia = {
      id: uid("render_video"),
      owner: state.profile,
      bucket: "project-video",
      mediaType: "video",
      fileName: `${project.name.replace(/[^\w-]/g, "_")}.mp4`,
      mimeType: "video/mp4",
      size: videoBlob.size || 0,
      createdAt: nowISO(),
      block: "Vrac",
      orientation: project.config?.aspectRatio === "horizontal" ? "horizontal" : "vertical",
      tags: [],
      blob: videoBlob
    };

    await mediaPut(renderedMedia);

    await projectPut({
      ...project,
      updatedAt: nowISO(),
      status: "Vidéo prête",
      config: {
        ...project.config,
        renderStatus: "done",
        finalVideoMediaId: renderedMedia.id
      }
    });

    await hydrateCache();
    state.currentResultId = project.id;
    render();
    showToast("Vidéo prête.");
  } catch (error) {
    console.error(error);

    await projectPut({
      ...project,
      updatedAt: nowISO(),
      status: "Erreur de rendu",
      config: {
        ...project.config,
        renderStatus: "error"
      }
    });

    await hydrateCache();
    render();
    showToast(error.message || "Erreur de rendu.");
  } finally {
    state.temp.renderBusyProjectId = null;
    render();
  }
}

async function downloadFinalVideo(projectId) {
  const project = state.cache.projects.find((p) => p.id === projectId);
  if (!project?.config?.finalVideoMediaId) {
    showToast("Aucune vidéo finale disponible.");
    return;
  }

  const media = await mediaGetById(project.config.finalVideoMediaId);
  if (!media?.blob) {
    showToast("Vidéo introuvable.");
    return;
  }

  triggerDownloadBlob(media.blob, media.fileName || "montage.mp4");
}

/* =========================
   Delete media everywhere
========================= */
async function deleteMediaEverywhere(mediaId) {
  await mediaDelete(mediaId);

  state.temp.musicDraft.selectedMediaIds = (state.temp.musicDraft.selectedMediaIds || []).filter((id) => id !== mediaId);
  state.temp.speechDraft.selectedMediaIds = (state.temp.speechDraft.selectedMediaIds || []).filter((id) => id !== mediaId);

  for (const project of state.cache.projects) {
    const nextSelected = (project.config?.selectedMediaIds || []).filter((id) => id !== mediaId);
    const nextFinalVideoId = project.config?.finalVideoMediaId === mediaId ? null : project.config?.finalVideoMediaId;

    let nextPlan = project.config?.montagePlan || null;
    if (nextPlan?.timeline) {
      nextPlan = {
        ...nextPlan,
        selectedMediaIds: (nextPlan.selectedMediaIds || []).filter((id) => id !== mediaId),
        timeline: (nextPlan.timeline || []).filter((item) => item.mediaId !== mediaId)
      };
    }

    await projectPut({
      ...project,
      updatedAt: nowISO(),
      config: {
        ...project.config,
        selectedMediaIds: nextSelected,
        montagePlan: nextPlan,
        finalVideoMediaId: nextFinalVideoId,
        renderStatus: nextFinalVideoId ? project.config?.renderStatus : "draft"
      }
    });
  }

  await saveMusicDraft();
  await saveSpeechDraft();
  await hydrateCache();
  render();
  showToast("Média supprimé.");
}

/* =========================
   Projects list
========================= */
function renderProjectsList() {
  const container = document.getElementById("projectsList");
  if (!container) return;

  container.innerHTML = "";

  if (!state.cache.projects.length) {
    container.innerHTML = `<div class="empty-state">Aucun projet pour le moment.</div>`;
    return;
  }

  state.cache.projects.forEach((project) => {
    const hasFinalVideo = !!project.config?.finalVideoMediaId;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <article class="project-card">
        <div class="project-card-top">
          <div>
            <h3 class="project-title">${escapeHtml(project.name)}</h3>
            <div class="small-note">${projectTypeLabel(project.type)} • ${aspectRatioLabel(project.config?.aspectRatio || "vertical")}</div>
          </div>
          <span class="project-status">${escapeHtml(project.status || "Local uniquement")}</span>
        </div>

        <div class="small-note">Créé le ${formatDate(project.createdAt)}<br>Mis à jour le ${formatDate(project.updatedAt)}</div>
        <div class="small-note">Source médias : ${sourceModeLabel(project.config?.mediaSourceMode || "single")}</div>

        <div class="project-actions">
          <button type="button" data-action="open-project" data-id="${project.id}">Ouvrir</button>
          <button type="button" data-action="resume-project" data-id="${project.id}">Reprendre</button>
          ${hasFinalVideo ? `<button type="button" data-action="download-final-video" data-id="${project.id}">Télécharger vidéo</button>` : ""}
          <button type="button" data-action="export-project-json" data-id="${project.id}">Exporter JSON</button>
          <button type="button" data-action="delete-project" data-id="${project.id}">Supprimer</button>
        </div>
      </article>
    `;
    container.appendChild(wrapper.firstElementChild);
  });
}

/* =========================
   Global actions
========================= */
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;

  if (action === "open-admin") {
    setRoute("adminLogin");
    return;
  }

  if (action === "enter-profile") {
    await enterProfile(target.dataset.profile);
    return;
  }

  if (action === "go-route") {
    setRoute(target.dataset.route);
    return;
  }

  if (action === "logout") {
    await logoutProfile();
    return;
  }

  if (action === "toggle-theme") {
    await toggleTheme();
    return;
  }

  if (action === "open-library") {
    state.libraryMode = target.dataset.mode;
    state.libraryType = target.dataset.type;
    setRoute("library");
    return;
  }

  if (action === "open-media-viewer") {
    openMediaViewer(target.dataset.id);
    return;
  }

  if (action === "delete-media") {
    const confirmed = window.confirm("Supprimer ce média ?");
    if (!confirmed) return;
    await deleteMediaEverywhere(target.dataset.id);
    return;
  }

  if (action === "change-media-block") {
    const media = state.cache.media.find((m) => m.id === target.dataset.id);
    if (!media) return;
    const nextBlock = window.prompt(`Nouveau bloc pour "${media.fileName}"`, media.block || "Vrac");
    if (!nextBlock) return;

    const cleanBlock = normalizeBlock(nextBlock);
    if (!allMediaBlocks().includes(cleanBlock)) {
      state.customBlocks.push(cleanBlock);
      state.customBlocks = [...new Set(state.customBlocks)].sort((a, b) => a.localeCompare(b, "fr"));
      await saveCustomBlocks();
    }

    await mediaPut({ ...media, block: cleanBlock });
    await hydrateCache();
    render();
    showToast("Bloc modifié.");
    return;
  }

  if (action === "create-custom-block") {
    const name = window.prompt("Nom du nouveau bloc");
    if (!name) return;
    const clean = normalizeBlock(name);
    if (allMediaBlocks().includes(clean)) {
      showToast("Ce bloc existe déjà.");
      return;
    }
    state.customBlocks.push(clean);
    state.customBlocks = [...new Set(state.customBlocks)].sort((a, b) => a.localeCompare(b, "fr"));
    await saveCustomBlocks();
    render();
    showToast("Bloc créé.");
    return;
  }

  if (action === "toggle-project-media") {
    const mediaId = target.dataset.mediaId;
    const kind = target.dataset.kind;

    if (kind === "speech") {
      const ids = new Set(state.temp.speechDraft.selectedMediaIds || []);
      ids.has(mediaId) ? ids.delete(mediaId) : ids.add(mediaId);
      state.temp.speechDraft.selectedMediaIds = [...ids];
      await saveSpeechDraft();
      render();
      return;
    }

    if (kind === "music") {
      const ids = new Set(state.temp.musicDraft.selectedMediaIds || []);
      ids.has(mediaId) ? ids.delete(mediaId) : ids.add(mediaId);
      state.temp.musicDraft.selectedMediaIds = [...ids];
      await saveMusicDraft();
      render();
      return;
    }
  }

  if (action === "move-project-media") {
    const direction = Number(target.dataset.direction || 0);
    const index = Number(target.dataset.index || 0);
    const kind = target.dataset.kind;

    if (kind === "speech") {
      const ids = state.temp.speechDraft.selectedMediaIds || [];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= ids.length) return;
      state.temp.speechDraft.selectedMediaIds = moveItem(ids, index, nextIndex);
      await saveSpeechDraft();
      render();
      return;
    }

    if (kind === "music") {
      const ids = state.temp.musicDraft.selectedMediaIds || [];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= ids.length) return;
      state.temp.musicDraft.selectedMediaIds = moveItem(ids, index, nextIndex);

      if (state.temp.musicMontagePlan?.selectedMediaIds?.length) {
        state.temp.musicMontagePlan.selectedMediaIds = [...state.temp.musicDraft.selectedMediaIds];
      }

      await saveMusicDraft();
      render();
      return;
    }
  }

  if (action === "remove-project-media") {
    const index = Number(target.dataset.index || 0);
    const kind = target.dataset.kind;

    if (kind === "speech") {
      const ids = [...(state.temp.speechDraft.selectedMediaIds || [])];
      ids.splice(index, 1);
      state.temp.speechDraft.selectedMediaIds = ids;
      await saveSpeechDraft();
      render();
      return;
    }

    if (kind === "music") {
      const ids = [...(state.temp.musicDraft.selectedMediaIds || [])];
      ids.splice(index, 1);
      state.temp.musicDraft.selectedMediaIds = ids;
      if (state.temp.musicMontagePlan?.selectedMediaIds?.length) {
        state.temp.musicMontagePlan.selectedMediaIds = [...ids];
        state.temp.musicMontagePlan.timeline = (state.temp.musicMontagePlan.timeline || []).filter((item) => ids.includes(item.mediaId));
      }
      await saveMusicDraft();
      render();
      return;
    }
  }

  if (action === "set-sora-duration") {
    state.temp.soraDuration = Number(target.dataset.duration || 10);
    await saveSoraDraft();
    render();
    return;
  }

  if (action === "render-project-video") {
    await renderProjectVideo(target.dataset.id);
    return;
  }

  if (action === "download-final-video") {
    await downloadFinalVideo(target.dataset.id);
    return;
  }

  if (action === "open-project") {
    const project = state.cache.projects.find((item) => item.id === target.dataset.id);
    if (!project) return;
    state.currentResultId = project.id;
    setRoute("result");
    return;
  }

  if (action === "resume-project") {
    const project = state.cache.projects.find((item) => item.id === target.dataset.id);
    if (!project) return;

    if (project.type === "speech") {
      await loadSpeechProjectIntoDraft(project);
      setRoute("speechProject");
      return;
    }

    if (project.type === "music") {
      await loadMusicProjectIntoDraft(project);
      setRoute("musicProject");
      return;
    }

    if (project.type === "sora") {
      await loadSoraProjectIntoDraft(project);
      setRoute("sora");
      return;
    }

    state.currentResultId = project.id;
    setRoute("result");
  }

  if (action === "export-project-json") {
    const project = state.cache.projects.find((item) => item.id === target.dataset.id);
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    triggerDownloadBlob(blob, `${project.name.replace(/[^\w-]/g, "_")}.json`);
    showToast("Projet JSON exporté.");
    return;
  }

  if (action === "delete-project") {
    const project = state.cache.projects.find((item) => item.id === target.dataset.id);
    if (!project) return;
    const confirmed = window.confirm(`Supprimer le projet "${project.name}" ?`);
    if (!confirmed) return;
    await projectDelete(project.id);
    await hydrateCache();
    render();
    showToast("Projet supprimé.");
    return;
  }

  if (action === "copy-main-meta") {
    const project = state.cache.projects.find((item) => item.id === state.currentResultId);
    if (project) await copyText(project.mainMeta || "");
    return;
  }

  if (action === "copy-short-meta") {
    const project = state.cache.projects.find((item) => item.id === state.currentResultId);
    if (project) await copyText(project.shortMeta || "");
    return;
  }

  if (action === "copy-speech-general-meta") {
    await copyText(state.temp.speechMetaGeneral || "");
    return;
  }

  if (action === "copy-speech-short-meta") {
    await copyText(state.temp.speechMetaShorts || "");
    return;
  }

  if (action === "copy-music-analysis") {
    await copyText(state.temp.musicAnalysis ? stringifyPretty(state.temp.musicAnalysis) : "");
    return;
  }

  if (action === "copy-music-ideas") {
    await copyText(state.temp.musicClipIdeas ? stringifyPretty(state.temp.musicClipIdeas) : "");
    return;
  }

  if (action === "copy-music-plan") {
    await copyText(state.temp.musicMontagePlan ? stringifyPretty(state.temp.musicMontagePlan) : "");
    return;
  }

  if (action === "copy-all-sora") {
    const text = (state.temp.lastSoraPrompts || []).map((item) => item.prompt || item.text || "").join("\n\n");
    if (text) await copyText(text);
    return;
  }

  if (action === "copy-sora-prompt") {
    await copyText(decodeURIComponent(target.dataset.text || ""));
    return;
  }

  if (action === "clear-cache") {
    const confirmed = window.confirm(`Supprimer tous les projets et médias locaux de ${profileLabel(state.profile)} ?`);
    if (!confirmed) return;

    for (const media of state.cache.media) await mediaDelete(media.id);
    for (const project of state.cache.projects) await projectDelete(project.id);

    state.currentResultId = null;
    state.temp.lastSoraPrompts = [];
    state.temp.speechMetaGeneral = "";
    state.temp.speechMetaShorts = "";
    state.temp.speechAudioBlob = null;
    state.temp.musicAnalysis = null;
    state.temp.musicClipIdeas = null;
    state.temp.musicMontagePlan = null;
    state.temp.musicMetaGeneral = "";
    state.temp.musicMetaShorts = "";

    resetObjectUrl(state.temp.speechAudioUrl);
    state.temp.speechAudioUrl = "";
    resetObjectUrl(state.temp.musicAudioUrl);
    state.temp.musicAudioUrl = "";
    resetObjectUrl(state.temp.soraAudioUrl);
    state.temp.soraAudioUrl = "";

    await hydrateCache();
    await saveSpeechDraft();
    await saveMusicDraft();
    await saveSoraDraft();
    render();
    showToast("Cache local nettoyé.");
  }
});

backButton.addEventListener("click", goBack);

themeToggle.addEventListener("click", async () => {
  await toggleTheme();
});

bottomTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (!state.profile) return;
    state.route = tab.dataset.route;
    render();
  });
});

/* =========================
   Profile
========================= */
async function enterProfile(profile) {
  state.profile = profile;
  state.history = [];
  state.currentResultId = null;

  await loadCustomBlocks();
  await hydrateCache();
  await loadSpeechDraft();
  await loadMusicDraft();
  await loadSoraDraft();

  state.route = "dashboard";
  render();
}

async function logoutProfile() {
  state.profile = null;
  state.history = [];
  state.currentResultId = null;
  state.temp.lastSoraPrompts = [];
  state.temp.musicAnalysis = null;
  state.temp.musicClipIdeas = null;
  state.temp.musicMontagePlan = null;
  state.temp.musicMetaGeneral = "";
  state.temp.musicMetaShorts = "";

  resetObjectUrl(state.temp.speechAudioUrl);
  state.temp.speechAudioUrl = "";
  resetObjectUrl(state.temp.musicAudioUrl);
  state.temp.musicAudioUrl = "";
  resetObjectUrl(state.temp.soraAudioUrl);
  state.temp.soraAudioUrl = "";

  await hydrateCache();
  state.route = "profiles";
  render();
}

/* =========================
   Init
========================= */
async function bootstrap() {
  await openDb();
  state.theme = await kvGet("theme", "theme-dark");
  state.adminPassword = await kvGet("adminPassword", ADMIN_PASSWORD_DEFAULT);
  await loadCustomBlocks();
  await applyTheme(state.theme);
  await hydrateCache();
  render();
}

bootstrap().catch((error) => {
  console.error(error);
  showToast("Erreur au démarrage de l’application.");
});
