const APP_NAME = "Montage IA Mobile";
const DB_NAME = "montage-ia-mobile-stable";
const DB_VERSION = 1;
const ADMIN_PASSWORD_DEFAULT = "admin123";
const MAX_SHORTS_META_LENGTH = 99;

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
    soraAudioFile: null,
    soraAudioUrl: "",
    soraAudioDuration: 0,
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

/* =========================
   Utils
========================= */
function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
    "project-audio": "Audios projet"
  }[bucket] || bucket;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
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
    "Choisis ton audio, le début, la durée finale et le type de montage.",
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
  return panel(
    "Projet speech",
    "Colle ton texte, choisis une voix, puis prépare le montage.",
    `
      <form id="speechProjectForm" class="stack-form">
        <label class="field">
          <span>Nom du projet</span>
          <input id="speechProjectName" type="text" placeholder="Ex : Narration teaser 1" />
        </label>

        <label class="field">
          <span>Texte à lire</span>
          <textarea id="speechText" rows="8" placeholder="Colle ton texte ici..."></textarea>
        </label>

        <div class="row-2">
          <label class="field">
            <span>Voix</span>
            <select id="speechVoice">
              <option value="male">Masculine</option>
              <option value="female">Féminine</option>
            </select>
          </label>

          <label class="field">
            <span>Ton</span>
            <select id="speechTone">
              <option value="normal">Normal</option>
              <option value="emotion">Émotion</option>
              <option value="calm">Calme</option>
              <option value="energetic">Énergique</option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Vitesse</span>
            <select id="speechSpeed">
              <option value="0.9">Lente</option>
              <option value="1" selected>Normale</option>
              <option value="1.1">Rapide</option>
            </select>
          </label>

          <label class="field">
            <span>Type de montage</span>
            <select id="speechMode">
              <option value="video">Montage vidéo</option>
              <option value="image">Montage image</option>
            </select>
          </label>
        </div>

        <div class="media-preview-card">
          <audio id="speechAudioPlayer" controls preload="metadata"></audio>
          <p class="small-note">La voix générée sera l’audio final du projet.</p>
        </div>

        <div class="sticky-actions">
          <button class="secondary-btn" id="speechGenerateVoiceBtn" type="button">Générer la voix</button>
          <button class="primary-btn" type="submit">Créer le projet speech</button>
        </div>
      </form>
    `
  );
}

function libraryTemplate() {
  const bucket = `${state.libraryMode}-${state.libraryType}`;
  return panel(
    "Bibliothèque",
    "Une seule bibliothèque avec filtres pour éviter les doublons d’écrans.",
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
    "Trouve tes brouillons, rendus et prompts générés.",
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
    "Prévisualisation, métas, partage et export.",
    `
      <div class="result-video-card">
        <video controls playsinline></video>
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta réseaux sociaux</h3>
          <button class="chip-btn" type="button" data-action="copy-main-meta">Copier</button>
        </div>
        <pre class="meta-output">${project.mainMeta || "Aucune méta générée."}</pre>
      </div>

      <div class="result-box">
        <div class="result-box-head">
          <h3>Méta YouTube Shorts</h3>
          <button class="chip-btn" type="button" data-action="copy-short-meta">Copier</button>
        </div>
        <pre class="meta-output">${project.shortMeta || "Aucune méta générée."}</pre>
      </div>

      <div class="sticky-actions">
        <button class="secondary-btn" type="button" data-action="share-project" data-id="${project.id}">Partager</button>
        <button class="primary-btn" type="button" data-action="export-project" data-id="${project.id}">Exporter</button>
      </div>
    `
  );
}

function soraTemplate() {
  return panel(
    "Assistant prompts Sora",
    "L’application ne génère pas la vidéo ici. Elle découpe l’audio et prépare les prompts à copier.",
    `
      <form id="soraForm" class="stack-form">
        <label class="field">
          <span>Nom du projet prompts</span>
          <input id="soraProjectName" type="text" placeholder="Ex : Sora clip spatial" />
        </label>

        <label class="field">
          <span>Audio</span>
          <input id="soraAudioInput" type="file" accept="audio/*" />
        </label>

        <div class="media-preview-card">
          <audio id="soraAudioPlayer" controls preload="metadata"></audio>
          <div class="audio-meta">
            <p><strong>Début :</strong> <span id="soraStartLabel">0 s</span></p>
            <p><strong>Fin :</strong> <span id="soraEndLabel">0 s</span></p>
            <p><strong>Durée utile :</strong> <span id="soraRangeLabel">0 s</span></p>
          </div>
        </div>

        <div class="row-2">
          <label class="field">
            <span>Début</span>
            <input id="soraStartTime" type="number" min="0" step="0.1" value="0" />
          </label>

          <label class="field">
            <span>Fin</span>
            <input id="soraEndTime" type="number" min="0" step="0.1" value="0" />
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
            <option value="realisme">Réalisme</option>
            <option value="sombre">Sombre</option>
            <option value="cinematique">Cinématique</option>
            <option value="emotion">Émotion</option>
            <option value="urbain">Urbain</option>
            <option value="spatial">Spatial</option>
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
   Music project
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
      start,
      end,
      targetDuration,
      mode: state.musicMode,
      style: state.musicStyle
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
   Speech project
========================= */
function createSilentWavBlob(durationSeconds) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const totalSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: "audio/wav" });
}

function estimateSpeechDuration(textValue, speedValue) {
  const words = safeText(textValue).split(/\s+/).filter(Boolean).length;
  const base = Math.max(2, words / 2.6);
  return base / Number(speedValue || 1);
}

function bindSpeechProject() {
  document.getElementById("speechGenerateVoiceBtn")?.addEventListener("click", async () => {
    const textValue = safeText(document.getElementById("speechText")?.value);
    const speedValue = document.getElementById("speechSpeed")?.value || "1";
    const player = document.getElementById("speechAudioPlayer");

    if (!textValue) {
      showToast("Colle un texte avant de générer la voix.");
      return;
    }

    resetObjectUrl(state.temp.speechAudioUrl);

    const duration = estimateSpeechDuration(textValue, speedValue);
    const blob = createSilentWavBlob(duration);
    const url = URL.createObjectURL(blob);

    state.temp.speechAudioBlob = blob;
    state.temp.speechAudioUrl = url;
    state.temp.speechAudioDuration = duration;

    player.src = url;
    player.load();
    showToast("Aperçu audio prêt.");
  });

  document.getElementById("speechProjectForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createSpeechProject();
  });
}

async function createSpeechProject() {
  const name = safeText(document.getElementById("speechProjectName")?.value) || `Projet speech ${new Date().toLocaleDateString("fr-FR")}`;
  const textValue = safeText(document.getElementById("speechText")?.value);

  if (!textValue) {
    showToast("Colle un texte.");
    return;
  }

  const voice = document.getElementById("speechVoice")?.value || "male";
  const tone = document.getElementById("speechTone")?.value || "normal";
  const speed = Number(document.getElementById("speechSpeed")?.value || 1);
  const mode = document.getElementById("speechMode")?.value || "video";

  let audioId = null;

  if (state.temp.speechAudioBlob) {
    const audioRecord = {
      id: uid("speech_audio"),
      owner: state.profile,
      bucket: "project-audio",
      mediaType: "audio",
      fileName: `${name.replace(/[^\w-]/g, "_")}_voice.wav`,
      mimeType: "audio/wav",
      size: state.temp.speechAudioBlob.size || 0,
      createdAt: nowISO(),
      blob: state.temp.speechAudioBlob
    };
    await mediaPut(audioRecord);
    audioId = audioRecord.id;
  }

  const hashtags = makeHashtags(["Speech", "Narration", tone, mode, "MontageIA"]);
  const mainMeta = buildMainMeta({
    title: `${name} narration`,
    description: `${mode === "image" ? "Montage image" : "Montage vidéo"}, voix ${voice === "female" ? "féminine" : "masculine"}, ton ${tone}.`,
    hashtags
  });

  const shortMeta = buildShortMeta({
    title: name,
    description: tone,
    hashtags: hashtags.slice(0, 2)
  });

  const project = {
    id: uid("project"),
    owner: state.profile,
    type: "speech",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      text: textValue,
      voice,
      tone,
      speed,
      mode,
      audioId
    },
    mainMeta,
    shortMeta
  };

  await projectPut(project);
  await hydrateCache();
  state.currentResultId = project.id;
  state.route = "result";
  render();
  showToast("Projet speech créé.");
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
            <h3 class="project-title">${project.name}</h3>
            <div class="small-note">${project.type === "music" ? "Projet musique" : project.type === "speech" ? "Projet speech" : "Prompts Sora"}</div>
          </div>
          <span class="project-status">${project.status || "Local uniquement"}</span>
        </div>

        <div class="small-note">
          Créé le ${formatDate(project.createdAt)}<br>
          Mis à jour le ${formatDate(project.updatedAt)}
        </div>

        <div class="project-actions">
          <button type="button" data-action="open-project" data-id="${project.id}">Ouvrir</button>
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
function getSoraCameraHint(style) {
  return {
    realisme: "caméra réaliste, mouvements naturels, détails crédibles",
    sombre: "caméra sombre, tension visuelle, lumière contrastée",
    cinematique: "caméra cinématique fluide, profondeur de champ, plans élégants",
    emotion: "caméra douce, plans émotionnels, regard expressif",
    urbain: "caméra urbaine nerveuse, énergie de rue, mouvement vivant",
    spatial: "caméra futuriste, ampleur spatiale, sensation de voyage"
  }[style] || "caméra réaliste, mouvements naturels";
}

function createSoraSegments(start, end, segmentDuration) {
  const segments = [];
  let cursor = start;
  let index = 1;

  while (cursor < end) {
    const next = Math.min(cursor + segmentDuration, end);
    segments.push({
      index,
      start: Number(cursor.toFixed(1)),
      end: Number(next.toFixed(1))
    });
    cursor = next;
    index += 1;
  }

  return segments;
}

function bindSora() {
  const audioInput = document.getElementById("soraAudioInput");
  const audioPlayer = document.getElementById("soraAudioPlayer");
  const startInput = document.getElementById("soraStartTime");
  const endInput = document.getElementById("soraEndTime");
  const form = document.getElementById("soraForm");

  const refreshLabels = () => {
    const duration = state.temp.soraAudioDuration || 0;
    const start = clamp(Number(startInput.value || 0), 0, duration);
    const end = clamp(Number(endInput.value || 0), 0, duration);
    const actualEnd = Math.max(start, end);

    document.getElementById("soraStartLabel").textContent = formatSeconds(start);
    document.getElementById("soraEndLabel").textContent = formatSeconds(actualEnd);
    document.getElementById("soraRangeLabel").textContent = formatSeconds(actualEnd - start);
  };

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
      startInput.value = 0;
      endInput.value = state.temp.soraAudioDuration.toFixed(1);
      refreshLabels();
    };
  });

  startInput?.addEventListener("input", refreshLabels);
  endInput?.addEventListener("input", refreshLabels);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createSoraProject();
  });
}

async function createSoraProject() {
  const name = safeText(document.getElementById("soraProjectName")?.value) || `Prompts Sora ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temp.soraAudioFile;
  const totalDuration = state.temp.soraAudioDuration || 0;

  if (!audioFile) {
    showToast("Ajoute un audio.");
    return;
  }

  const start = clamp(Number(document.getElementById("soraStartTime")?.value || 0), 0, totalDuration);
  const end = clamp(Number(document.getElementById("soraEndTime")?.value || 0), 0, totalDuration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const style = document.getElementById("soraStyle")?.value || "realisme";

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

  const segments = createSoraSegments(start, end, state.soraDuration);
  const prompts = segments.map((segment, idx) => {
    const mood =
      idx === 0 ? "introduction forte" :
      idx === segments.length - 1 ? "fin marquante" :
      idx >= Math.floor(segments.length / 2) ? "montée intense" :
      "progression visuelle";

    return {
      index: segment.index,
      start: segment.start,
      end: segment.end,
      text: `Prompt ${segment.index} - de ${formatSeconds(segment.start)} à ${formatSeconds(segment.end)}
Séquence de ${Math.round(segment.end - segment.start)} secondes, ${mood}, ${getSoraCameraHint(style)}, scène cohérente avec la musique, intensité adaptée au passage, continuité avec le segment précédent, rendu pensé pour Sora 2.`
    };
  });

  const project = {
    id: uid("project"),
    owner: state.profile,
    type: "sora",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      audioId: audioRecord.id,
      start,
      end,
      promptDuration: state.soraDuration,
      style
    },
    prompts,
    mainMeta: "",
    shortMeta: ""
  };

  await projectPut(project);
  await hydrateCache();
  state.temp.lastSoraPrompts = prompts;
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
      <div class="prompt-text">${item.text.replace(/\n/g, "<br>")}</div>
      <div class="prompt-actions">
        <button type="button" data-action="copy-sora-prompt" data-text="${encodeURIComponent(item.text)}">Copier ce prompt</button>
      </div>
    `;
    container.appendChild(article);
  });
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
    await hydrateCache();
    render();
    showToast("Cache local nettoyé.");
    return;
  }

  if (action === "open-project") {
    const project = state.cache.projects.find(item => item.id === target.dataset.id);
    if (!project) return;

    if (project.type === "sora") {
      state.temp.lastSoraPrompts = project.prompts || [];
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

  if (action === "copy-all-sora") {
    const text = (state.temp.lastSoraPrompts || []).map(item => item.text).join("\n\n");
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
  state.route = "dashboard";
  render();
}

async function logoutProfile() {
  state.profile = null;
  state.history = [];
  state.currentResultId = null;
  state.temp.lastSoraPrompts = [];
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
