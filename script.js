const APP_NAME = "Montage IA Mobile";
const DB_NAME = "montage-ia-mobile-final-base";
const DB_VERSION = 1;
const ADMIN_PASSWORD_DEFAULT = "admin123";
const MAX_SHORTS_META_LENGTH = 99;
const BACKEND_BASE_URL = "https://montge-vid-o-automatique.onrender.com";

const state = {
  route: "profiles",
  history: [],
  profile: null,
  theme: "theme-dark",
  adminPassword: ADMIN_PASSWORD_DEFAULT,

  libraryMode: "music",
  libraryType: "image",

  musicMode: "video",
  musicStyle: "social",

  soraDuration: 10,

  currentResultId: null,

  temp: {
    musicAudioFile: null,
    musicAudioUrl: "",
    musicAudioDuration: 0,

    speechAudioBlob: null,
    speechAudioUrl: "",
    speechAudioDuration: 0,
    speechMetaGeneral: "",
    speechMetaShorts: "",
    speechGenerating: false,
    speechDraft: {
      id: null,
      name: "",
      text: "",
      voice: "male",
      tone: "normal",
      speed: "1",
      mode: "video",
      montageMode: "auto"
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

async function projectGetById(id) {
  const store = await getStore("projects");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
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
    user1: "Utilisateur 1",
    user2: "Utilisateur 2",
    user3: "Utilisateur 3"
  }[profile] || "Profil";
}

function bucketLabel(bucket) {
  return {
    "music-image": "Images musique",
    "music-video": "Vidéos musique",
    "speech-image": "Images speech",
    "speech-video": "Vidéos speech",
    "project-audio": "Audios projet",
    "project-video": "Vidéos projet"
  }[bucket] || bucket;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2400);
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

function resetObjectUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function makeHashtags(tags) {
  return tags
    .map((tag) => tag.replace(/[^a-zA-Z0-9àâäéèêëïîôöùûüç]/gi, ""))
    .filter(Boolean)
    .map((tag) => `#${tag.toLowerCase()}`);
}

function buildMainMeta({ title, description, hashtags }) {
  return `${title}\n${description}\n${hashtags.join(" ")}`;
}

function buildShortMeta({ title, description, hashtags }) {
  let text = [title, description, hashtags.join(" ")].filter(Boolean).join("\n");
  if (text.length <= MAX_SHORTS_META_LENGTH) return text;

  text = [title, hashtags.slice(0, 2).join(" ")].filter(Boolean).join("\n");
  if (text.length <= MAX_SHORTS_META_LENGTH) return text;

  return text.slice(0, MAX_SHORTS_META_LENGTH).trim();
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
   API helpers
========================= */
async function postJson(path, body) {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || "Erreur serveur");
  }

  return data;
}

/* =========================
   Persist drafts
========================= */
function speechDraftKey(profile) {
  return `speech_draft_${profile}`;
}

function soraDraftKey(profile) {
  return `sora_draft_${profile}`;
}

async function saveSpeechDraft() {
  if (!state.profile) return;
  await kvSet(speechDraftKey(state.profile), {
    draft: state.temp.speechDraft,
    metaGeneral: state.temp.speechMetaGeneral,
    metaShorts: state.temp.speechMetaShorts
  });
}

async function loadSpeechDraft() {
  if (!state.profile) return;
  const data = await kvGet(speechDraftKey(state.profile), null);
  if (!data) return;

  state.temp.speechDraft = {
    ...state.temp.speechDraft,
    ...(data.draft || {})
  };
  state.temp.speechMetaGeneral = data.metaGeneral || "";
  state.temp.speechMetaShorts = data.metaShorts || "";
}

async function saveSoraDraft() {
  if (!state.profile) return;
  await kvSet(soraDraftKey(state.profile), {
    draft: state.temp.soraDraft,
    promptDuration: state.soraDuration
  });
}

async function loadSoraDraft() {
  if (!state.profile) return;
  const data = await kvGet(soraDraftKey(state.profile), null);
  if (!data) return;

  state.temp.soraDraft = {
    ...state.temp.soraDraft,
    ...(data.draft || {})
  };
  state.soraDuration = [10, 15].includes(Number(data.promptDuration))
    ? Number(data.promptDuration)
    : state.soraDuration;
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
  state.cache.media = media.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* =========================
   Navigation
========================= */
function setRoute(route, push = true) {
  if (push && state.route !== route) {
    state.history.push(state.route);
  }
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
    profiles: APP_NAME,
    adminLogin: "Connexion admin",
    dashboard: "Accueil",
    musicProject: "Projet musique",
    speechProject: "Projet speech",
    library: "Bibliothèque",
    projects: "Mes projets",
    settings: "Paramètres",
    result: "Résultat",
    sora: "Assistant prompts Sora"
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
        <h2>Choisis un profil</h2>
        <p class="hero-text">Admin avec mot de passe. Les autres profils entrent directement.</p>
      </div>

      <div class="profile-grid">
        <button class="profile-card admin-card" data-action="open-admin">
          <span class="profile-badge">Admin</span>
          <span class="profile-name">Administrateur</span>
          <span class="profile-desc">Réglages, partage, gestion</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user1">
          <span class="profile-badge">Utilisateur 1</span>
          <span class="profile-name">Mon espace</span>
          <span class="profile-desc">Projets et médias locaux</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user2">
          <span class="profile-badge">Utilisateur 2</span>
          <span class="profile-name">Mon espace</span>
          <span class="profile-desc">Projets et médias locaux</span>
        </button>

        <button class="profile-card" data-action="enter-profile" data-profile="user3">
          <span class="profile-badge">Utilisateur 3</span>
          <span class="profile-name">Mon espace</span>
          <span class="profile-desc">Projets et médias locaux</span>
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
        <p class="hero-text">Crée un projet musique, un projet speech, gère tes médias, ou prépare des prompts Sora.</p>
      </div>

      <div class="action-grid">
        <button class="action-card" data-action="go-route" data-route="musicProject">
          <span class="action-icon">🎵</span>
          <span class="action-title">Projet musique</span>
          <span class="action-desc">Audio + durée + style + montage</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="speechProject">
          <span class="action-icon">🗣️</span>
          <span class="action-title">Projet speech</span>
          <span class="action-desc">Texte + voix + montage</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="sora">
          <span class="action-icon">✨</span>
          <span class="action-title">Assistant prompts Sora</span>
          <span class="action-desc">Découpe audio + prompts 10 s ou 15 s</span>
        </button>

        <button class="action-card" data-action="open-library" data-mode="music" data-type="image">
          <span class="action-icon">🖼️</span>
          <span class="action-title">Bibliothèque musique</span>
          <span class="action-desc">Images et vidéos du mode musique</span>
        </button>

        <button class="action-card" data-action="open-library" data-mode="speech" data-type="image">
          <span class="action-icon">🎬</span>
          <span class="action-title">Bibliothèque speech</span>
          <span class="action-desc">Images et vidéos du mode speech</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="projects">
          <span class="action-icon">📁</span>
          <span class="action-title">Mes projets</span>
          <span class="action-desc">Brouillons, rendus et exports</span>
        </button>

        <button class="action-card" data-action="go-route" data-route="settings">
          <span class="action-icon">⚙️</span>
          <span class="action-title">Paramètres</span>
          <span class="action-desc">Thème, stockage, nettoyage</span>
        </button>

        <button class="action-card" data-action="logout">
          <span class="action-icon">↩️</span>
          <span class="action-title">Changer de profil</span>
          <span class="action-desc">Retour à l’écran d’accueil</span>
        </button>
      </div>
    </section>
  `;
}

function musicProjectTemplate() {
  return panel(
    "Projet musique",
    "Socle stable pour la musique. Le montage avancé viendra dans la prochaine mise à jour.",
    `
      <form id="musicProjectForm" class="stack-form">
        <label class="field">
          <span>Nom du projet</span>
          <input id="musicProjectName" type="text" placeholder="Ex : Clip sombre 1" />
        </label>

        <label class="field">
          <span>Audio principal</span>
          <input id="musicAudioInput" type="file" accept="audio/*" />
        </label>

        <div class="media-preview-card">
          <audio id="musicAudioPlayer" controls preload="metadata"></audio>
          <div class="audio-meta">
            <p><strong>Début choisi :</strong> <span id="musicStartLabel">0 s</span></p>
            <p><strong>Fin choisie :</strong> <span id="musicEndLabel">0 s</span></p>
            <p><strong>Durée sélectionnée :</strong> <span id="musicRangeLabel">0 s</span></p>
          </div>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Début audio</span>
            <input id="musicStartTime" type="number" min="0" step="0.1" value="0" />
          </label>

          <label class="field">
            <span>Fin audio</span>
            <input id="musicEndTime" type="number" min="0" step="0.1" value="0" />
          </label>
        </div>

        <label class="field">
          <span>Durée finale du montage</span>
          <select id="musicDuration">
            <option value="20">20 secondes</option>
            <option value="30" selected>30 secondes</option>
            <option value="60">1 minute</option>
            <option value="120">2 minutes</option>
            <option value="300">5 minutes</option>
          </select>
        </label>

        <div class="segmented-group">
          <p class="segment-title">Type de montage</p>
          <div class="segmented-buttons">
            <button class="segment-btn ${state.musicMode === "video" ? "active" : ""}" type="button" data-action="set-music-mode" data-mode="video">Montage vidéo</button>
            <button class="segment-btn ${state.musicMode === "image" ? "active" : ""}" type="button" data-action="set-music-mode" data-mode="image">Montage image</button>
          </div>
        </div>

        <div class="segmented-group">
          <p class="segment-title">Style dominant</p>
          <div class="chip-wrap">
            ${["social", "cinematique", "emotion", "sombre"].map(style => `
              <button class="chip-btn ${state.musicStyle === style ? "active" : ""}" type="button" data-action="set-music-style" data-style="${style}">
                ${style === "social" ? "Social" : style === "cinematique" ? "Cinématique" : style === "emotion" ? "Émotion" : "Sombre"}
              </button>
            `).join("")}
          </div>
        </div>

        <div class="sticky-actions">
          <button class="secondary-btn" type="button" data-action="open-library" data-mode="music" data-type="${state.musicMode === "image" ? "image" : "video"}">
            Ouvrir la bibliothèque ${state.musicMode === "image" ? "images" : "vidéos"}
          </button>
          <button class="primary-btn" type="submit">Créer le projet musique</button>
        </div>
      </form>
    `
  );
}

function speechProjectTemplate() {
  const draft = state.temp.speechDraft;

  return panel(
    "Projet speech",
    "Texte + voix IA + métadonnées. Le futur montage manuel avancé se branchera sur cette base.",
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
            <span>Voix</span>
            <select id="speechVoice">
              <option value="male" ${draft.voice === "male" ? "selected" : ""}>Masculine</option>
              <option value="female" ${draft.voice === "female" ? "selected" : ""}>Féminine</option>
            </select>
          </label>

          <label class="field">
            <span>Ton</span>
            <select id="speechTone">
              <option value="normal" ${draft.tone === "normal" ? "selected" : ""}>Normal</option>
              <option value="emotion" ${draft.tone === "emotion" ? "selected" : ""}>Émotion</option>
              <option value="calm" ${draft.tone === "calm" ? "selected" : ""}>Calme</option>
              <option value="energetic" ${draft.tone === "energetic" ? "selected" : ""}>Énergique</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Vitesse</span>
            <select id="speechSpeed">
              <option value="0.9" ${draft.speed === "0.9" ? "selected" : ""}>Lente</option>
              <option value="1" ${draft.speed === "1" ? "selected" : ""}>Normale</option>
              <option value="1.1" ${draft.speed === "1.1" ? "selected" : ""}>Rapide</option>
            </select>
          </label>

          <label class="field">
            <span>Type de montage</span>
            <select id="speechMode">
              <option value="video" ${draft.mode === "video" ? "selected" : ""}>Montage vidéo</option>
              <option value="image" ${draft.mode === "image" ? "selected" : ""}>Montage image</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Mode de montage</span>
          <select id="speechMontageMode">
            <option value="auto" ${draft.montageMode === "auto" ? "selected" : ""}>Automatique</option>
            <option value="manual" ${draft.montageMode === "manual" ? "selected" : ""}>Manuel</option>
          </select>
        </label>

        <div class="media-preview-card">
          <audio id="speechAudioPlayer" controls preload="metadata" ${state.temp.speechAudioUrl ? `src="${state.temp.speechAudioUrl}"` : ""}></audio>
          <p class="small-note">La voix générée sera l’audio principal du projet.</p>
        </div>

        <div class="sticky-actions">
          <button id="speechGenerateCompleteBtn" class="secondary-btn" type="button">
            ${state.temp.speechGenerating ? "Génération..." : "Générer contenu complet"}
          </button>
          <button class="secondary-btn" type="button" data-action="open-library" data-mode="speech" data-type="${draft.mode === "video" ? "video" : "image"}">
            Ouvrir la bibliothèque ${draft.mode === "video" ? "vidéos" : "images"}
          </button>
          <button class="primary-btn" type="submit">Créer le projet speech</button>
        </div>
      </form>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta réseaux sociaux</h3>
          <button class="chip-btn" type="button" data-action="copy-speech-general-meta">Copier</button>
        </div>
        <pre class="meta-output" id="speechGeneralMetaOutput">${escapeHtml(state.temp.speechMetaGeneral || "Aucune métadonnée générée.")}</pre>
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta YouTube Shorts</h3>
          <button class="chip-btn" type="button" data-action="copy-speech-short-meta">Copier</button>
        </div>
        <pre class="meta-output" id="speechShortMetaOutput">${escapeHtml(state.temp.speechMetaShorts || "Aucune métadonnée générée.")}</pre>
      </div>
    `
  );
}

function libraryTemplate() {
  const bucket = `${state.libraryMode}-${state.libraryType}`;
  return panel(
    "Bibliothèque",
    "Bibliothèque locale persistante par profil. Rien ne doit disparaître après reconnexion.",
    `
      <div class="stack-form">
        <div class="row-2">
          <label class="field">
            <span>Mode</span>
            <select id="libraryModeSelect">
              <option value="music" ${state.libraryMode === "music" ? "selected" : ""}>Musique</option>
              <option value="speech" ${state.libraryMode === "speech" ? "selected" : ""}>Speech</option>
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

        <div class="pill">${bucketLabel(bucket)}</div>

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
    "Les projets doivent rester disponibles après fermeture, recharge et reconnexion.",
    `
      <div id="projectsList" class="card-list"></div>
    `
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
        </div>

        <button class="danger-btn" type="button" data-action="clear-cache">Nettoyer le cache local</button>
      </div>
    `
  );
}

function resultTemplate() {
  const project = state.cache.projects.find(item => item.id === state.currentResultId);

  if (!project) {
    return panel("Résultat", "Aucun projet sélectionné.", `<div class="empty-state">Aucun résultat à afficher.</div>`);
  }

  return panel(
    "Résultat du projet",
    "Projet rouvert depuis le stockage local. Les métadonnées doivent rester disponibles.",
    `
      <div class="result-video-card">
        <video controls playsinline></video>
      </div>

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
        <button class="secondary-btn" type="button" data-action="share-project" data-id="${project.id}">Partager</button>
        <button class="primary-btn" type="button" data-action="export-project" data-id="${project.id}">Exporter</button>
      </div>
    `
  );
}

function soraTemplate() {
  const draft = state.temp.soraDraft;

  return panel(
    "Assistant prompts Sora",
    "Découpage audio + prompts IA horodatés + sauvegarde locale.",
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
            <button class="segment-btn ${state.soraDuration === 10 ? "active" : ""}" type="button" data-action="set-sora-duration" data-duration="10">10 secondes</button>
            <button class="segment-btn ${state.soraDuration === 15 ? "active" : ""}" type="button" data-action="set-sora-duration" data-duration="15">15 secondes</button>
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

  if (state.route === "musicProject") {
    bindMusicProject();
  }

  if (state.route === "speechProject") {
    bindSpeechProject();
  }

  if (state.route === "library") {
    bindLibrary();
  }

  if (state.route === "projects") {
    renderProjectsList();
  }

  if (state.route === "sora") {
    bindSora();
    renderSoraResults(state.temp.lastSoraPrompts);
  }
}

/* =========================
   Music
========================= */
function bindMusicProject() {
  const audioInput = document.getElementById("musicAudioInput");
  const audioPlayer = document.getElementById("musicAudioPlayer");
  const startInput = document.getElementById("musicStartTime");
  const endInput = document.getElementById("musicEndTime");
  const form = document.getElementById("musicProjectForm");

  const refreshLabels = () => {
    const duration = state.temp.musicAudioDuration || 0;
    const start = clamp(Number(startInput.value || 0), 0, duration);
    const end = clamp(Number(endInput.value || 0), 0, duration);
    const actualEnd = Math.max(start, end);

    document.getElementById("musicStartLabel").textContent = formatSeconds(start);
    document.getElementById("musicEndLabel").textContent = formatSeconds(actualEnd);
    document.getElementById("musicRangeLabel").textContent = formatSeconds(actualEnd - start);
  };

  audioInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    resetObjectUrl(state.temp.musicAudioUrl);
    state.temp.musicAudioFile = file;

    if (!file) {
      state.temp.musicAudioDuration = 0;
      state.temp.musicAudioUrl = "";
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
      startInput.value = 0;
      endInput.value = 0;
      refreshLabels();
      return;
    }

    const url = URL.createObjectURL(file);
    state.temp.musicAudioUrl = url;
    audioPlayer.src = url;
    audioPlayer.onloadedmetadata = () => {
      state.temp.musicAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      startInput.value = 0;
      endInput.value = state.temp.musicAudioDuration.toFixed(1);
      refreshLabels();
    };
  });

  startInput?.addEventListener("input", refreshLabels);
  endInput?.addEventListener("input", refreshLabels);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createMusicProject();
  });
}

async function createMusicProject() {
  const name = safeText(document.getElementById("musicProjectName")?.value) || `Projet musique ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temp.musicAudioFile;

  if (!audioFile) {
    showToast("Ajoute un audio principal.");
    return;
  }

  const duration = state.temp.musicAudioDuration || 0;
  const start = clamp(Number(document.getElementById("musicStartTime")?.value || 0), 0, duration);
  const end = clamp(Number(document.getElementById("musicEndTime")?.value || 0), 0, duration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const targetDuration = Number(document.getElementById("musicDuration")?.value || 30);

  const audioRecord = {
    id: uid("audio"),
    owner: state.profile,
    bucket: "project-audio",
    mediaType: "audio",
    fileName: audioFile.name,
    mimeType: audioFile.type || "audio/*",
    size: audioFile.size || 0,
    createdAt: nowISO(),
    blob: audioFile
  };
  await mediaPut(audioRecord);

  const hashtags = makeHashtags([
    "MontageIA",
    "Clip",
    state.musicStyle,
    state.musicMode === "image" ? "PhotoEdit" : "VideoEdit"
  ]);

  const mainMeta = buildMainMeta({
    title: `${name} ${state.musicStyle}`,
    description: `Montage ${state.musicMode === "image" ? "image" : "vidéo"}, ambiance ${state.musicStyle}, prêt à publier.`,
    hashtags
  });

  const shortMeta = buildShortMeta({
    title: name,
    description: state.musicStyle,
    hashtags: hashtags.slice(0, 2)
  });

  const project = {
    id: uid("project"),
    owner: state.profile,
    type: "music",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      audioMediaId: audioRecord.id,
      audioStart: start,
      audioEnd: end,
      targetDuration,
      mode: state.musicMode,
      style: state.musicStyle,
      montageMode: "auto",
      timeline: [],
      selectedMediaIds: [],
      renderStatus: "draft",
      finalVideoMediaId: null
    },
    mainMeta,
    shortMeta
  };

  await projectPut(project);
  await hydrateCache();
  state.currentResultId = project.id;
  state.route = "result";
  render();
  showToast("Projet musique créé.");
}

/* =========================
   Speech
========================= */
const debouncedSaveSpeechDraft = debounce(() => {
  saveSpeechDraft().catch(console.error);
}, 500);

function bindSpeechProject() {
  const nameInput = document.getElementById("speechProjectName");
  const textInput = document.getElementById("speechText");
  const voiceSelect = document.getElementById("speechVoice");
  const toneSelect = document.getElementById("speechTone");
  const speedSelect = document.getElementById("speechSpeed");
  const modeSelect = document.getElementById("speechMode");
  const montageModeSelect = document.getElementById("speechMontageMode");
  const generateBtn = document.getElementById("speechGenerateCompleteBtn");
  const form = document.getElementById("speechProjectForm");

  const syncDraft = () => {
    state.temp.speechDraft = {
      ...state.temp.speechDraft,
      name: nameInput?.value || "",
      text: textInput?.value || "",
      voice: voiceSelect?.value || "male",
      tone: toneSelect?.value || "normal",
      speed: speedSelect?.value || "1",
      mode: modeSelect?.value || "video",
      montageMode: montageModeSelect?.value || "auto"
    };
    debouncedSaveSpeechDraft();
  };

  [nameInput, textInput, voiceSelect, toneSelect, speedSelect, modeSelect, montageModeSelect].forEach((el) => {
    el?.addEventListener("input", syncDraft);
    el?.addEventListener("change", syncDraft);
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
  const title = safeText(draft.name) || "Projet speech";
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
        voice: draft.voice,
        notes: "Réponse en un seul bloc, sans écrire Titre Description Hashtags, 5 hashtags max."
      }),
      fetch(`${BACKEND_BASE_URL}/api/speech/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          voiceGender: draft.voice,
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
  const name = safeText(draft.name) || `Projet speech ${new Date().toLocaleDateString("fr-FR")}`;
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

  const fallbackHashtags = makeHashtags(["Speech", "Narration", draft.tone, draft.mode, "MontageIA"]);

  const mainMeta =
    state.temp.speechMetaGeneral ||
    buildMainMeta({
      title: `${name} narration`,
      description: `${draft.mode === "image" ? "Montage image" : "Montage vidéo"}, voix ${draft.voice === "female" ? "féminine" : "masculine"}, ton ${draft.tone}.`,
      hashtags: fallbackHashtags
    });

  const shortMeta =
    state.temp.speechMetaShorts ||
    buildShortMeta({
      title: name,
      description: draft.tone,
      hashtags: fallbackHashtags.slice(0, 2)
    });

  const project = {
    id: draft.id || uid("project"),
    owner: state.profile,
    type: "speech",
    name,
    createdAt: draft.id ? (state.cache.projects.find(p => p.id === draft.id)?.createdAt || nowISO()) : nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      text: textValue,
      voiceFamily: draft.voice === "female" ? "Feminin" : "Masculin",
      voiceStyle: draft.voice,
      tone: draft.tone,
      speed: draft.speed,
      mode: draft.mode,
      montageMode: draft.montageMode,
      generatedAudioMediaId: audioRecord.id,
      timeline: [],
      selectedMediaIds: [],
      renderStatus: "draft",
      finalVideoMediaId: null
    },
    mainMeta,
    shortMeta
  };

  await projectPut(project);
  await hydrateCache();

  state.temp.speechDraft.id = project.id;
  await saveSpeechDraft();

  state.currentResultId = project.id;
  state.route = "result";
  render();
  showToast("Projet speech créé.");
}

async function loadSpeechProjectIntoDraft(project) {
  state.temp.speechDraft = {
    id: project.id,
    name: project.name || "",
    text: project.config?.text || "",
    voice: project.config?.voiceStyle === "female" ? "female" : "male",
    tone: project.config?.tone || "normal",
    speed: project.config?.speed || "1",
    mode: project.config?.mode || "video",
    montageMode: project.config?.montageMode || "auto"
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

  document.getElementById("libraryFileInput")?.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;

    const bucket = `${state.libraryMode}-${state.libraryType}`;

    for (const file of files) {
      await mediaPut({
        id: uid("media"),
        owner: state.profile,
        bucket,
        mediaType: state.libraryType,
        fileName: file.name,
        mimeType: file.type || "*/*",
        size: file.size || 0,
        createdAt: nowISO(),
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

  const bucket = `${state.libraryMode}-${state.libraryType}`;
  const items = state.cache.media.filter(item => item.bucket === bucket);

  grid.innerHTML = "";

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">Aucun média dans cette section.</div>`;
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "media-card";

    if (item.mediaType === "image") {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(item.blob);
      img.alt = item.fileName;
      article.appendChild(img);
    } else {
      const video = document.createElement("video");
      video.src = URL.createObjectURL(item.blob);
      video.muted = true;
      video.playsInline = true;
      article.appendChild(video);
    }

    const label = document.createElement("div");
    label.className = "media-card-label";
    label.textContent = `${item.fileName} • ${bytesToMB(item.size || 0)}`;
    article.appendChild(label);

    grid.appendChild(article);
  });
}

/* =========================
   Projects
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
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <article class="project-card">
        <div class="project-card-top">
          <div>
            <h3 class="project-title">${escapeHtml(project.name)}</h3>
            <div class="small-note">${project.type === "music" ? "Projet musique" : project.type === "speech" ? "Projet speech" : "Prompts Sora"}</div>
          </div>
          <span class="project-status">${escapeHtml(project.status || "Local uniquement")}</span>
        </div>

        <div class="small-note">
          Créé le ${formatDate(project.createdAt)}<br>
          Mis à jour le ${formatDate(project.updatedAt)}
        </div>

        <div class="project-actions">
          <button type="button" data-action="open-project" data-id="${project.id}">Ouvrir</button>
          <button type="button" data-action="resume-project" data-id="${project.id}">Reprendre</button>
          <button type="button" data-action="export-project" data-id="${project.id}">Exporter</button>
          <button type="button" data-action="delete-project" data-id="${project.id}">Supprimer</button>
        </div>
      </article>
    `;
    container.appendChild(wrapper.firstElementChild);
  });
}

/* =========================
   Sora
========================= */
const debouncedSaveSoraDraft = debounce(() => {
  saveSoraDraft().catch(console.error);
}, 500);

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

  audioInput?.addEventListener("change", (event) => {
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
      return;
    }

    const url = URL.createObjectURL(file);
    state.temp.soraAudioUrl = url;
    audioPlayer.src = url;
    audioPlayer.onloadedmetadata = () => {
      state.temp.soraAudioDuration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
      if (!Number(endInput.value)) {
        endInput.value = state.temp.soraAudioDuration.toFixed(1);
      }
      refreshLabels();
    };
  });

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
  const name = safeText(draft.name) || `Prompts Sora ${new Date().toLocaleDateString("fr-FR")}`;
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
    fileName: audioFile.name,
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
    segmentDuration: state.soraDuration,
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
    createdAt: draft.id ? (state.cache.projects.find(p => p.id === draft.id)?.createdAt || nowISO()) : nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      audioMediaId: audioRecord.id,
      start,
      end,
      segmentDuration: state.soraDuration,
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
    container.innerHTML = `<div class="empty-state">Aucun prompt généré pour le moment.</div>`;
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
  state.soraDuration = project.config?.segmentDuration || 10;
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
   Global click actions
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

  if (action === "set-music-mode") {
    state.musicMode = target.dataset.mode;
    render();
    return;
  }

  if (action === "set-music-style") {
    state.musicStyle = target.dataset.style;
    render();
    return;
  }

  if (action === "set-sora-duration") {
    state.soraDuration = Number(target.dataset.duration || 10);
    await saveSoraDraft();
    render();
    return;
  }

  if (action === "clear-cache") {
    const confirmed = window.confirm(`Supprimer tous les projets et médias locaux de ${profileLabel(state.profile)} ?`);
    if (!confirmed) return;

    for (const media of state.cache.media) {
      await mediaDelete(media.id);
    }
    for (const project of state.cache.projects) {
      await projectDelete(project.id);
    }

    state.currentResultId = null;
    state.temp.lastSoraPrompts = [];
    state.temp.speechMetaGeneral = "";
    state.temp.speechMetaShorts = "";
    state.temp.speechAudioBlob = null;
    resetObjectUrl(state.temp.speechAudioUrl);
    state.temp.speechAudioUrl = "";
    resetObjectUrl(state.temp.soraAudioUrl);
    state.temp.soraAudioUrl = "";

    await hydrateCache();
    await saveSpeechDraft();
    await saveSoraDraft();
    render();
    showToast("Cache local nettoyé.");
    return;
  }

  if (action === "open-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    state.currentResultId = project.id;
    setRoute("result");
    return;
  }

  if (action === "resume-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    if (project.type === "speech") {
      await loadSpeechProjectIntoDraft(project);
      setRoute("speechProject");
      return;
    }

    if (project.type === "sora") {
      await loadSoraProjectIntoDraft(project);
      setRoute("sora");
      return;
    }

    state.currentResultId = project.id;
    setRoute("result");
    return;
  }

  if (action === "delete-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    const confirmed = window.confirm(`Supprimer le projet "${project.name}" ?`);
    if (!confirmed) return;

    await projectDelete(project.id);
    await hydrateCache();
    render();
    showToast("Projet supprimé.");
    return;
  }

  if (action === "export-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    const payload = JSON.stringify(project, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^\w-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Projet exporté.");
    return;
  }

  if (action === "share-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    const text = `${project.name}\n\n${project.mainMeta || ""}`.trim();

    if (navigator.share) {
      try {
        await navigator.share({ title: project.name, text });
        return;
      } catch {}
    }

    await copyText(text);
    return;
  }

  if (action === "copy-main-meta") {
    const project = state.cache.projects.find(item => item.id === state.currentResultId);
    if (!project) return;
    await copyText(project.mainMeta || "");
    return;
  }

  if (action === "copy-short-meta") {
    const project = state.cache.projects.find(item => item.id === state.currentResultId);
    if (!project) return;
    await copyText(project.shortMeta || "");
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

  if (action === "copy-all-sora") {
    const text = (state.temp.lastSoraPrompts || [])
      .map(item => item.prompt || item.text || "")
      .join("\n\n");
    if (!text) {
      showToast("Aucun prompt à copier.");
      return;
    }
    await copyText(text);
    return;
  }

  if (action === "copy-sora-prompt") {
    await copyText(decodeURIComponent(target.dataset.text || ""));
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

  await hydrateCache();
  await loadSpeechDraft();
  await loadSoraDraft();

  state.route = "dashboard";
  render();
}

async function logoutProfile() {
  state.profile = null;
  state.history = [];
  state.currentResultId = null;
  state.temp.lastSoraPrompts = [];

  resetObjectUrl(state.temp.speechAudioUrl);
  state.temp.speechAudioUrl = "";

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
  await applyTheme(state.theme);
  await hydrateCache();
  render();
}

bootstrap().catch((error) => {
  console.error(error);
  showToast("Erreur au démarrage de l’application.");
});
