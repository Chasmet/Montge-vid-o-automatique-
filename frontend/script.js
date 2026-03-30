const APP_NAME = "Montage IA Mobile";
const DB_NAME = "montage-ia-mobile-db";
const DB_VERSION = 1;
const DEFAULT_ADMIN_PASSWORD = "admin123";
const MAX_SHORTS_META_LENGTH = 99;

const state = {
  currentProfile: null,
  currentView: "view-profile-select",
  viewHistory: [],
  theme: "dark",
  adminPassword: DEFAULT_ADMIN_PASSWORD,
  musicMode: "video",
  musicStyle: "social",
  soraDuration: 10,
  currentResultProject: null,
  currentSoraProject: null,
  temporary: {
    musicAudioFile: null,
    musicAudioUrl: "",
    musicAudioDuration: 0,
    soraAudioFile: null,
    soraAudioUrl: "",
    soraAudioDuration: 0,
    speechVoiceBlob: null,
    speechVoiceUrl: "",
    speechVoiceDuration: 0
  },
  caches: {
    projects: [],
    musicLibrary: [],
    speechLibrary: []
  }
};

/* =========================
   Sélecteurs DOM
========================= */
const body = document.body;
const backButton = document.getElementById("backButton");
const themeToggle = document.getElementById("themeToggle");
const settingsThemeToggle = document.getElementById("settingsThemeToggle");
const appTitle = document.getElementById("appTitle");
const dashboardTitle = document.getElementById("dashboardTitle");
const toastEl = document.getElementById("toast");
const bottomNav = document.querySelector(".bottom-nav");

const views = [...document.querySelectorAll(".view")];
const bottomTabs = [...document.querySelectorAll(".bottom-tab")];
const profileButtons = [...document.querySelectorAll(".profile-card")];
const actionCards = [...document.querySelectorAll(".action-card")];

const adminLoginForm = document.getElementById("adminLoginForm");
const adminPasswordInput = document.getElementById("adminPassword");
const logoutButton = document.getElementById("logoutButton");

/* Projet musique */
const musicProjectName = document.getElementById("musicProjectName");
const musicAudioInput = document.getElementById("musicAudioInput");
const musicAudioPlayer = document.getElementById("musicAudioPlayer");
const musicStartTime = document.getElementById("musicStartTime");
const musicEndTime = document.getElementById("musicEndTime");
const musicStartLabel = document.getElementById("musicStartLabel");
const musicEndLabel = document.getElementById("musicEndLabel");
const musicRangeLabel = document.getElementById("musicRangeLabel");
const musicDuration = document.getElementById("musicDuration");
const musicModeButtons = [...document.querySelectorAll("[data-music-mode]")];
const musicStyleButtons = [...document.querySelectorAll("[data-music-style]")];
const musicCreateProjectBtn = document.getElementById("musicCreateProjectBtn");

/* Projet speech */
const speechProjectName = document.getElementById("speechProjectName");
const speechText = document.getElementById("speechText");
const speechVoice = document.getElementById("speechVoice");
const speechTone = document.getElementById("speechTone");
const speechSpeed = document.getElementById("speechSpeed");
const speechMode = document.getElementById("speechMode");
const speechAudioPlayer = document.getElementById("speechAudioPlayer");
const speechGenerateVoiceBtn = document.getElementById("speechGenerateVoiceBtn");
const speechCreateProjectBtn = document.getElementById("speechCreateProjectBtn");

/* Sora */
const soraProjectName = document.getElementById("soraProjectName");
const soraAudioInput = document.getElementById("soraAudioInput");
const soraAudioPlayer = document.getElementById("soraAudioPlayer");
const soraStartTime = document.getElementById("soraStartTime");
const soraEndTime = document.getElementById("soraEndTime");
const soraStartLabel = document.getElementById("soraStartLabel");
const soraEndLabel = document.getElementById("soraEndLabel");
const soraRangeLabel = document.getElementById("soraRangeLabel");
const soraDurationButtons = [...document.querySelectorAll("[data-sora-duration]")];
const soraStyle = document.getElementById("soraStyle");
const soraGeneratePromptsBtn = document.getElementById("soraGeneratePromptsBtn");
const soraPromptsList = document.getElementById("soraPromptsList");
const copyAllSoraPromptsBtn = document.getElementById("copyAllSoraPromptsBtn");

/* Projets */
const projectSearchInput = document.getElementById("projectSearchInput");
const projectFilterSelect = document.getElementById("projectFilterSelect");
const projectsList = document.getElementById("projectsList");

/* Bibliothèques */
const musicImagesInput = document.getElementById("musicImagesInput");
const musicVideosInput = document.getElementById("musicVideosInput");
const musicLibraryGrid = document.getElementById("musicLibraryGrid");

const speechImagesInput = document.getElementById("speechImagesInput");
const speechVideosInput = document.getElementById("speechVideosInput");
const speechLibraryGrid = document.getElementById("speechLibraryGrid");

/* Réglages */
const storageRefreshBtn = document.getElementById("storageRefreshBtn");
const storageUsedLabel = document.getElementById("storageUsedLabel");
const storageProjectsLabel = document.getElementById("storageProjectsLabel");
const storageMediaLabel = document.getElementById("storageMediaLabel");
const clearCacheBtn = document.getElementById("clearCacheBtn");

/* Résultat */
const resultVideoPlayer = document.getElementById("resultVideoPlayer");
const mainMetaOutput = document.getElementById("mainMetaOutput");
const shortMetaOutput = document.getElementById("shortMetaOutput");
const copyMainMetaBtn = document.getElementById("copyMainMetaBtn");
const copyShortMetaBtn = document.getElementById("copyShortMetaBtn");
const shareResultBtn = document.getElementById("shareResultBtn");
const exportResultBtn = document.getElementById("exportResultBtn");

/* =========================
   IndexedDB
========================= */
let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("projects")) {
        const projectStore = db.createObjectStore("projects", { keyPath: "id" });
        projectStore.createIndex("byOwner", "owner", { unique: false });
        projectStore.createIndex("byType", "type", { unique: false });
      }

      if (!db.objectStoreNames.contains("media")) {
        const mediaStore = db.createObjectStore("media", { keyPath: "id" });
        mediaStore.createIndex("byOwner", "owner", { unique: false });
        mediaStore.createIndex("byLibrary", "library", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function idbTransaction(storeName, mode = "readonly") {
  return openDatabase().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

async function kvGet(key, fallback = null) {
  const store = await idbTransaction("kv");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const store = await idbTransaction("kv", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function projectPut(project) {
  const store = await idbTransaction("projects", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(project);
    req.onsuccess = () => resolve(project);
    req.onerror = () => reject(req.error);
  });
}

async function projectDelete(id) {
  const store = await idbTransaction("projects", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function projectGetAllByOwner(owner) {
  const store = await idbTransaction("projects");
  return new Promise((resolve, reject) => {
    const index = store.index("byOwner");
    const req = index.getAll(owner);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function mediaPut(record) {
  const store = await idbTransaction("media", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function mediaDelete(id) {
  const store = await idbTransaction("media", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function mediaGetAllByOwner(owner) {
  const store = await idbTransaction("media");
  return new Promise((resolve, reject) => {
    const index = store.index("byOwner");
    const req = index.getAll(owner);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* =========================
   Utilitaires
========================= */
function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) {
    return `${safe.toFixed(1).replace(".0", "")} s`;
  }
  const m = Math.floor(safe / 60);
  const s = Math.round(safe % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function bytesToMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function safeText(value) {
  return (value || "").toString().trim();
}

function resetObjectUrl(currentUrl) {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copié.");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showToast("Copié.");
  }
}

function updateBottomNavVisibility() {
  if (state.currentProfile) {
    bottomNav.classList.remove("hidden");
  } else {
    bottomNav.classList.add("hidden");
  }
}

function getProfileLabel(profile) {
  const labels = {
    admin: "Admin",
    user1: "Utilisateur 1",
    user2: "Utilisateur 2",
    user3: "Utilisateur 3"
  };
  return labels[profile] || "Profil";
}

/* =========================
   Thème
========================= */
async function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  body.classList.toggle("theme-light", state.theme === "light");
  body.classList.toggle("theme-dark", state.theme !== "light");
  themeToggle.textContent = state.theme === "dark" ? "Mode clair" : "Mode sombre";
  settingsThemeToggle.textContent = state.theme === "dark" ? "Passer en clair" : "Passer en sombre";
  await kvSet("theme", state.theme);
}

async function toggleTheme() {
  const next = state.theme === "dark" ? "light" : "dark";
  await applyTheme(next);
}

/* =========================
   Navigation
========================= */
function setActiveBottomTab(viewId) {
  bottomTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.viewTarget === viewId);
  });
}

function updateBackButton() {
  const shouldShow =
    state.currentProfile &&
    state.currentView !== "view-dashboard" &&
    state.currentView !== "view-profile-select";
  backButton.classList.toggle("hidden", !shouldShow);
}

function showView(viewId, pushHistory = true) {
  if (!document.getElementById(viewId)) return;

  if (pushHistory && state.currentView && state.currentView !== viewId) {
    state.viewHistory.push(state.currentView);
  }

  state.currentView = viewId;

  views.forEach((view) => {
    view.classList.toggle("hidden", view.id !== viewId);
    view.classList.toggle("active", view.id === viewId);
  });

  setActiveBottomTab(viewId);
  updateBackButton();
  updateBottomNavVisibility();

  const pageTitles = {
    "view-profile-select": APP_NAME,
    "view-admin-login": "Connexion admin",
    "view-dashboard": `${APP_NAME} - Accueil`,
    "view-music-project": "Projet musique",
    "view-speech-project": "Projet speech",
    "view-sora-helper": "Assistant prompts Sora",
    "view-projects": "Mes projets",
    "view-music-library": "Bibliothèque musique",
    "view-speech-library": "Bibliothèque speech",
    "view-settings": "Paramètres",
    "view-result": "Résultat"
  };

  appTitle.textContent = pageTitles[viewId] || APP_NAME;
}

function goBack() {
  if (!state.viewHistory.length) {
    showView("view-dashboard", false);
    return;
  }
  const previous = state.viewHistory.pop();
  showView(previous, false);
}

/* =========================
   Session profil
========================= */
async function enterProfile(profile) {
  state.currentProfile = profile;
  dashboardTitle.textContent = `Bienvenue, ${getProfileLabel(profile)}`;
  state.viewHistory = [];
  await hydrateProfileData();
  showView("view-dashboard", false);
}

async function logoutProfile() {
  state.currentProfile = null;
  state.currentResultProject = null;
  state.currentSoraProject = null;
  state.viewHistory = [];
  dashboardTitle.textContent = "Ton espace";
  showView("view-profile-select", false);
}

/* =========================
   Fichiers audio
========================= */
function setAudioPlayerSource(player, url) {
  player.src = url || "";
  player.load();
}

function updateMusicRangeLabels() {
  const duration = state.temporary.musicAudioDuration || 0;
  const start = clamp(Number(musicStartTime.value || 0), 0, duration);
  const end = clamp(Number(musicEndTime.value || 0), 0, duration);
  const actualEnd = Math.max(start, end);
  const range = Math.max(0, actualEnd - start);

  musicStartLabel.textContent = formatSeconds(start);
  musicEndLabel.textContent = formatSeconds(actualEnd);
  musicRangeLabel.textContent = formatSeconds(range);
}

function updateSoraRangeLabels() {
  const duration = state.temporary.soraAudioDuration || 0;
  const start = clamp(Number(soraStartTime.value || 0), 0, duration);
  const end = clamp(Number(soraEndTime.value || 0), 0, duration);
  const actualEnd = Math.max(start, end);
  const range = Math.max(0, actualEnd - start);

  soraStartLabel.textContent = formatSeconds(start);
  soraEndLabel.textContent = formatSeconds(actualEnd);
  soraRangeLabel.textContent = formatSeconds(range);
}

async function handleMusicAudioSelection(file) {
  resetObjectUrl(state.temporary.musicAudioUrl);
  state.temporary.musicAudioFile = file || null;

  if (!file) {
    state.temporary.musicAudioUrl = "";
    state.temporary.musicAudioDuration = 0;
    setAudioPlayerSource(musicAudioPlayer, "");
    musicStartTime.value = 0;
    musicEndTime.value = 0;
    updateMusicRangeLabels();
    return;
  }

  const url = URL.createObjectURL(file);
  state.temporary.musicAudioUrl = url;
  setAudioPlayerSource(musicAudioPlayer, url);

  musicAudioPlayer.onloadedmetadata = () => {
    const duration = Number.isFinite(musicAudioPlayer.duration) ? musicAudioPlayer.duration : 0;
    state.temporary.musicAudioDuration = duration;
    musicStartTime.value = 0;
    musicEndTime.value = duration.toFixed(1);
    updateMusicRangeLabels();
  };
}

async function handleSoraAudioSelection(file) {
  resetObjectUrl(state.temporary.soraAudioUrl);
  state.temporary.soraAudioFile = file || null;

  if (!file) {
    state.temporary.soraAudioUrl = "";
    state.temporary.soraAudioDuration = 0;
    setAudioPlayerSource(soraAudioPlayer, "");
    soraStartTime.value = 0;
    soraEndTime.value = 0;
    updateSoraRangeLabels();
    return;
  }

  const url = URL.createObjectURL(file);
  state.temporary.soraAudioUrl = url;
  setAudioPlayerSource(soraAudioPlayer, url);

  soraAudioPlayer.onloadedmetadata = () => {
    const duration = Number.isFinite(soraAudioPlayer.duration) ? soraAudioPlayer.duration : 0;
    state.temporary.soraAudioDuration = duration;
    soraStartTime.value = 0;
    soraEndTime.value = duration.toFixed(1);
    updateSoraRangeLabels();
  };
}

/* =========================
   Bibliothèques médias
========================= */
async function saveLibraryFiles(files, library, mediaType) {
  if (!state.currentProfile || !files?.length) return;

  for (const file of files) {
    const record = {
      id: uid("media"),
      owner: state.currentProfile,
      library,
      mediaType,
      fileName: file.name,
      mimeType: file.type || (mediaType === "image" ? "image/*" : "video/*"),
      size: file.size || 0,
      createdAt: nowISO(),
      blob: file
    };
    await mediaPut(record);
  }

  await hydrateProfileData();
  await refreshStorageStats();
  showToast("Médias ajoutés.");
}

async function hydrateProfileData() {
  if (!state.currentProfile) return;

  const [allProjects, allMedia] = await Promise.all([
    projectGetAllByOwner(state.currentProfile),
    mediaGetAllByOwner(state.currentProfile)
  ]);

  state.caches.projects = allProjects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  state.caches.musicLibrary = allMedia.filter((item) => item.library === "music-library");
  state.caches.speechLibrary = allMedia.filter((item) => item.library === "speech-library");

  renderProjects();
  renderMusicLibrary();
  renderSpeechLibrary();
  await refreshStorageStats();
}

function buildMediaCard(record) {
  const article = document.createElement("article");
  article.className = "media-card";

  const url = URL.createObjectURL(record.blob);

  if (record.mediaType === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = record.fileName || "Image";
    article.appendChild(img);
  } else {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    article.appendChild(video);
  }

  const label = document.createElement("div");
  label.className = "media-card-label";
  label.textContent = `${record.fileName} • ${bytesToMB(record.size || 0)}`;
  article.appendChild(label);

  return article;
}

function renderMusicLibrary() {
  musicLibraryGrid.innerHTML = "";
  if (!state.caches.musicLibrary.length) {
    musicLibraryGrid.innerHTML = `
      <div class="empty-state small">
        <p>Aucun média dans la bibliothèque musique.</p>
      </div>
    `;
    return;
  }

  state.caches.musicLibrary.forEach((record) => {
    musicLibraryGrid.appendChild(buildMediaCard(record));
  });
}

function renderSpeechLibrary() {
  speechLibraryGrid.innerHTML = "";
  if (!state.caches.speechLibrary.length) {
    speechLibraryGrid.innerHTML = `
      <div class="empty-state small">
        <p>Aucun média dans la bibliothèque speech.</p>
      </div>
    `;
    return;
  }

  state.caches.speechLibrary.forEach((record) => {
    speechLibraryGrid.appendChild(buildMediaCard(record));
  });
}

/* =========================
   Métas
========================= */
function buildMainMeta({ title, description, hashtags }) {
  return `${title}\n${description}\n${hashtags.join(" ")}`;
}

function buildShortMeta({ title, description, hashtags }) {
  const tagText = hashtags.join(" ");
  let lines = [title.trim(), description.trim(), tagText.trim()].filter(Boolean);
  let merged = lines.join("\n");

  if (merged.length <= MAX_SHORTS_META_LENGTH) return merged;

  lines = [title.trim(), tagText.trim()].filter(Boolean);
  merged = lines.join("\n");
  if (merged.length <= MAX_SHORTS_META_LENGTH) return merged;

  let shortTitle = title.trim().slice(0, 22);
  let shortTags = hashtags.slice(0, 2).join(" ");
  merged = `${shortTitle}\n${shortTags}`.trim();

  if (merged.length > MAX_SHORTS_META_LENGTH) {
    merged = merged.slice(0, MAX_SHORTS_META_LENGTH).trim();
  }

  return merged;
}

function makeHashtags(list) {
  return list
    .map((tag) => tag.replace(/[^a-zA-Z0-9àâäéèêëïîôöùûüç]/gi, ""))
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.toLowerCase()}`));
}

function generateMusicMeta(project) {
  const styleLabelMap = {
    social: "social",
    cinematique: "cinématique",
    emotion: "émotion",
    sombre: "sombre"
  };

  const style = styleLabelMap[project.config.style] || "cinématique";
  const modeLabel = project.config.mode === "image" ? "visuel image" : "visuel vidéo";
  const durationLabel = project.config.targetDuration >= 60
    ? `${Math.round(project.config.targetDuration / 60)}min`
    : `${project.config.targetDuration}s`;

  const title = `${project.name} ${style}`;
  const description = `Montage ${modeLabel}, ambiance ${style}, format ${durationLabel}, prêt à publier.`;
  const hashtags = makeHashtags([
    "MontageIA",
    "Clip",
    style,
    project.config.mode === "image" ? "PhotoEdit" : "VideoEdit",
    durationLabel
  ]);

  const mainMeta = buildMainMeta({ title, description, hashtags });
  const shortMeta = buildShortMeta({
    title: project.name,
    description: style,
    hashtags: hashtags.slice(0, 2)
  });

  return { mainMeta, shortMeta };
}

function generateSpeechMeta(project) {
  const voiceLabel = project.config.voice === "female" ? "voix féminine" : "voix masculine";
  const toneLabelMap = {
    normal: "naturel",
    emotion: "émotion",
    calm: "calme",
    energetic: "énergique"
  };
  const tone = toneLabelMap[project.config.tone] || "naturel";
  const modeLabel = project.config.mode === "image" ? "montage image" : "montage vidéo";

  const title = `${project.name} narration`;
  const description = `${modeLabel}, ${voiceLabel}, ton ${tone}, prêt pour les réseaux.`;
  const hashtags = makeHashtags(["Speech", "Narration", tone, project.config.mode, "MontageIA"]);

  const mainMeta = buildMainMeta({ title, description, hashtags });
  const shortMeta = buildShortMeta({
    title: project.name,
    description: tone,
    hashtags: hashtags.slice(0, 2)
  });

  return { mainMeta, shortMeta };
}

/* =========================
   Projets
========================= */
function filteredProjects() {
  const search = safeText(projectSearchInput.value).toLowerCase();
  const filter = projectFilterSelect.value;

  return state.caches.projects.filter((project) => {
    const matchesSearch =
      !search ||
      project.name.toLowerCase().includes(search) ||
      (project.type || "").toLowerCase().includes(search);

    const matchesFilter = filter === "all" || project.type === filter;
    return matchesSearch && matchesFilter;
  });
}

function renderProjects() {
  const projects = filteredProjects();
  projectsList.innerHTML = "";

  if (!projects.length) {
    projectsList.innerHTML = `
      <div class="empty-state">
        <p>Aucun projet pour le moment.</p>
      </div>
    `;
    return;
  }

  projects.forEach((project) => {
    const card = document.createElement("article");
    card.className = "project-card";

    const typeLabelMap = {
      music: "Projet musique",
      speech: "Projet speech",
      sora: "Prompts Sora"
    };

    card.innerHTML = `
      <div class="project-card-top">
        <div>
          <h3 class="project-title">${project.name}</h3>
          <div class="project-type">${typeLabelMap[project.type] || "Projet"}</div>
        </div>
        <span class="project-status">${project.status || "Local uniquement"}</span>
      </div>

      <div class="project-meta">
        Créé le ${formatDate(project.createdAt)}<br>
        Mis à jour le ${formatDate(project.updatedAt)}
      </div>

      <div class="project-actions">
        <button type="button" data-open-project="${project.id}">Ouvrir</button>
        <button type="button" data-export-project="${project.id}">Exporter</button>
        <button type="button" data-delete-project="${project.id}">Supprimer</button>
      </div>
    `;

    projectsList.appendChild(card);
  });

  [...projectsList.querySelectorAll("[data-open-project]")].forEach((btn) => {
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.openProject;
      const project = state.caches.projects.find((item) => item.id === projectId);
      if (!project) return;
      await openProject(project);
    });
  });

  [...projectsList.querySelectorAll("[data-export-project]")].forEach((btn) => {
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.exportProject;
      const project = state.caches.projects.find((item) => item.id === projectId);
      if (!project) return;
      downloadProjectJson(project);
    });
  });

  [...projectsList.querySelectorAll("[data-delete-project]")].forEach((btn) => {
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.deleteProject;
      const project = state.caches.projects.find((item) => item.id === projectId);
      if (!project) return;

      const confirmed = window.confirm(`Supprimer le projet "${project.name}" ?`);
      if (!confirmed) return;

      await projectDelete(projectId);
      await hydrateProfileData();
      showToast("Projet supprimé.");
    });
  });
}

async function openProject(project) {
  if (project.type === "sora") {
    state.currentSoraProject = project;
    renderSoraProject(project);
    showView("view-sora-helper");
    return;
  }

  state.currentResultProject = project;
  renderResultProject(project);
  showView("view-result");
}

function renderResultProject(project) {
  resultVideoPlayer.removeAttribute("src");
  resultVideoPlayer.load();

  mainMetaOutput.textContent = project.mainMeta || "Aucune méta générée.";
  shortMetaOutput.textContent = project.shortMeta || "Aucune méta générée.";
}

function downloadProjectJson(project) {
  const payload = JSON.stringify(project, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.name.replace(/[^\w-]/g, "_")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Export du projet prêt.");
}

/* =========================
   Projet musique
========================= */
async function createMusicProject() {
  if (!state.currentProfile) return;

  const name = safeText(musicProjectName.value) || `Projet musique ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temporary.musicAudioFile;

  if (!audioFile) {
    showToast("Ajoute un audio principal.");
    return;
  }

  const duration = state.temporary.musicAudioDuration || 0;
  const start = clamp(Number(musicStartTime.value || 0), 0, duration);
  const end = clamp(Number(musicEndTime.value || 0), 0, duration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const audioRecord = {
    id: uid("audio"),
    owner: state.currentProfile,
    library: "project-audio",
    mediaType: "audio",
    fileName: audioFile.name,
    mimeType: audioFile.type || "audio/*",
    size: audioFile.size || 0,
    createdAt: nowISO(),
    blob: audioFile
  };
  await mediaPut(audioRecord);

  const project = {
    id: uid("project"),
    owner: state.currentProfile,
    type: "music",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      audioMediaId: audioRecord.id,
      audioName: audioFile.name,
      start,
      end,
      selectedDuration: Math.max(0, end - start),
      targetDuration: Number(musicDuration.value),
      mode: state.musicMode,
      style: state.musicStyle
    }
  };

  const { mainMeta, shortMeta } = generateMusicMeta(project);
  project.mainMeta = mainMeta;
  project.shortMeta = shortMeta;

  await projectPut(project);
  await hydrateProfileData();

  state.currentResultProject = project;
  renderResultProject(project);
  showView("view-result");

  showToast("Projet musique créé.");
}

/* =========================
   Projet speech
========================= */
function estimateSpeechDuration(textValue, speedValue) {
  const words = safeText(textValue).split(/\s+/).filter(Boolean).length;
  const baseDuration = Math.max(2, words / 2.6);
  const speed = Number(speedValue || 1);
  return baseDuration / speed;
}

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

async function generateSpeechVoiceLocally() {
  const textValue = safeText(speechText.value);
  if (!textValue) {
    showToast("Colle un texte avant de générer la voix.");
    return;
  }

  const estimatedDuration = estimateSpeechDuration(textValue, speechSpeed.value);
  const blob = createSilentWavBlob(estimatedDuration);
  resetObjectUrl(state.temporary.speechVoiceUrl);

  const url = URL.createObjectURL(blob);
  state.temporary.speechVoiceBlob = blob;
  state.temporary.speechVoiceUrl = url;
  state.temporary.speechVoiceDuration = estimatedDuration;

  setAudioPlayerSource(speechAudioPlayer, url);
  showToast("Aperçu audio local prêt.");
}

async function createSpeechProject() {
  if (!state.currentProfile) return;

  const name = safeText(speechProjectName.value) || `Projet speech ${new Date().toLocaleDateString("fr-FR")}`;
  const textValue = safeText(speechText.value);

  if (!textValue) {
    showToast("Colle un texte.");
    return;
  }

  let voiceMediaId = null;
  if (state.temporary.speechVoiceBlob) {
    const speechBlobFileName = `${name.replace(/[^\w-]/g, "_")}_voice.wav`;
    const audioRecord = {
      id: uid("speech_audio"),
      owner: state.currentProfile,
      library: "project-audio",
      mediaType: "audio",
      fileName: speechBlobFileName,
      mimeType: "audio/wav",
      size: state.temporary.speechVoiceBlob.size || 0,
      createdAt: nowISO(),
      blob: state.temporary.speechVoiceBlob
    };
    await mediaPut(audioRecord);
    voiceMediaId = audioRecord.id;
  }

  const project = {
    id: uid("project"),
    owner: state.currentProfile,
    type: "speech",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      text: textValue,
      voice: speechVoice.value,
      tone: speechTone.value,
      speed: Number(speechSpeed.value),
      mode: speechMode.value,
      generatedAudioMediaId: voiceMediaId,
      estimatedDuration: state.temporary.speechVoiceDuration || estimateSpeechDuration(textValue, speechSpeed.value)
    }
  };

  const { mainMeta, shortMeta } = generateSpeechMeta(project);
  project.mainMeta = mainMeta;
  project.shortMeta = shortMeta;

  await projectPut(project);
  await hydrateProfileData();

  state.currentResultProject = project;
  renderResultProject(project);
  showView("view-result");

  showToast("Projet speech créé.");
}

/* =========================
   Assistant prompts Sora
========================= */
function getSoraSegmentMood(index, total) {
  if (index === 0) return "introduction forte";
  if (index === total - 1) return "fin marquante";
  if (index >= Math.floor(total / 2)) return "montée intense";
  return "progression visuelle";
}

function getSoraCameraHint(styleValue) {
  const map = {
    realisme: "caméra réaliste, mouvements naturels, détails crédibles",
    sombre: "caméra cinématique sombre, lumière contrastée, tension visuelle",
    cinematique: "caméra cinématique fluide, profondeur de champ, plans élégants",
    emotion: "caméra douce, plans chargés d’émotion, regard expressif",
    urbain: "caméra urbaine nerveuse, énergie de rue, mouvement vivant",
    spatial: "caméra futuriste, ampleur spatiale, sensation de voyage"
  };
  return map[styleValue] || map.realisme;
}

function buildSoraPromptText({ styleValue, segmentIndex, totalSegments, durationSeconds, start, end }) {
  const mood = getSoraSegmentMood(segmentIndex, totalSegments);
  const camera = getSoraCameraHint(styleValue);
  const durationLabel = `${Math.round(end - start)} secondes`;

  return `Séquence de ${durationLabel}, ${mood}, ${camera}, progression cohérente avec la musique, intensité adaptée au passage, scène visuelle claire, mouvement naturel, continuité avec le segment précédent, rendu pensé pour Sora 2.`;
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
      end: Number(next.toFixed(1)),
      length: Number((next - cursor).toFixed(1))
    });
    cursor = next;
    index += 1;
  }

  return segments;
}

function renderSoraPrompts(prompts) {
  soraPromptsList.innerHTML = "";

  if (!prompts.length) {
    soraPromptsList.innerHTML = `
      <div class="empty-state small">
        <p>Aucun prompt généré pour le moment.</p>
      </div>
    `;
    return;
  }

  prompts.forEach((item) => {
    const card = document.createElement("article");
    card.className = "prompt-card";
    card.innerHTML = `
      <h4>Prompt ${item.index}</h4>
      <div class="prompt-time">De ${formatSeconds(item.start)} à ${formatSeconds(item.end)}</div>
      <div class="prompt-text">${item.text}</div>
      <div class="prompt-actions">
        <button type="button" data-copy-prompt="${item.index}">Copier ce prompt</button>
      </div>
    `;
    soraPromptsList.appendChild(card);
  });

  [...soraPromptsList.querySelectorAll("[data-copy-prompt]")].forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.copyPrompt);
      const item = prompts.find((p) => p.index === idx);
      if (!item) return;
      await copyText(`Prompt ${item.index} - de ${formatSeconds(item.start)} à ${formatSeconds(item.end)}\n${item.text}`);
    });
  });
}

function renderSoraProject(project) {
  const prompts = project.prompts || [];
  state.currentSoraProject = project;
  renderSoraPrompts(prompts);
}

async function generateSoraPromptsProject() {
  if (!state.currentProfile) return;

  const name = safeText(soraProjectName.value) || `Prompts Sora ${new Date().toLocaleDateString("fr-FR")}`;
  const audioFile = state.temporary.soraAudioFile;
  const totalDuration = state.temporary.soraAudioDuration || 0;

  if (!audioFile) {
    showToast("Ajoute un audio.");
    return;
  }

  const start = clamp(Number(soraStartTime.value || 0), 0, totalDuration);
  const end = clamp(Number(soraEndTime.value || 0), 0, totalDuration);

  if (end <= start) {
    showToast("La fin doit être après le début.");
    return;
  }

  const audioRecord = {
    id: uid("sora_audio"),
    owner: state.currentProfile,
    library: "project-audio",
    mediaType: "audio",
    fileName: audioFile.name,
    mimeType: audioFile.type || "audio/*",
    size: audioFile.size || 0,
    createdAt: nowISO(),
    blob: audioFile
  };
  await mediaPut(audioRecord);

  const segments = createSoraSegments(start, end, state.soraDuration);
  const prompts = segments.map((segment, idx) => ({
    index: segment.index,
    start: segment.start,
    end: segment.end,
    length: segment.length,
    text: buildSoraPromptText({
      styleValue: soraStyle.value,
      segmentIndex: idx,
      totalSegments: segments.length,
      durationSeconds: state.soraDuration,
      start: segment.start,
      end: segment.end
    })
  }));

  const project = {
    id: uid("project"),
    owner: state.currentProfile,
    type: "sora",
    name,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "Local uniquement",
    config: {
      audioMediaId: audioRecord.id,
      start,
      end,
      selectedDuration: Number((end - start).toFixed(1)),
      promptDuration: state.soraDuration,
      style: soraStyle.value
    },
    prompts,
    mainMeta: "",
    shortMeta: ""
  };

  await projectPut(project);
  await hydrateProfileData();

  state.currentSoraProject = project;
  renderSoraPrompts(prompts);

  showToast(`${prompts.length} prompts générés.`);
}

/* =========================
   Stockage
========================= */
async function refreshStorageStats() {
  if (!state.currentProfile) {
    storageUsedLabel.textContent = "0 Mo";
    storageProjectsLabel.textContent = "0";
    storageMediaLabel.textContent = "0";
    return;
  }

  const mediaItems = await mediaGetAllByOwner(state.currentProfile);
  const projects = await projectGetAllByOwner(state.currentProfile);

  const totalBytes = mediaItems.reduce((sum, item) => sum + (item.size || item.blob?.size || 0), 0);

  storageUsedLabel.textContent = bytesToMB(totalBytes);
  storageProjectsLabel.textContent = String(projects.length);
  storageMediaLabel.textContent = String(mediaItems.length);
}

async function clearCurrentProfileData() {
  if (!state.currentProfile) return;

  const confirmed = window.confirm(`Supprimer les projets et médias locaux de ${getProfileLabel(state.currentProfile)} ?`);
  if (!confirmed) return;

  const mediaItems = await mediaGetAllByOwner(state.currentProfile);
  const projects = await projectGetAllByOwner(state.currentProfile);

  for (const item of mediaItems) {
    await mediaDelete(item.id);
  }

  for (const project of projects) {
    await projectDelete(project.id);
  }

  state.currentResultProject = null;
  state.currentSoraProject = null;
  await hydrateProfileData();
  showToast("Cache local nettoyé.");
}

/* =========================
   Partage / export résultat
========================= */
async function shareCurrentResult() {
  if (!state.currentResultProject) {
    showToast("Aucun résultat à partager.");
    return;
  }

  const shareText = `${state.currentResultProject.name}\n\n${state.currentResultProject.mainMeta || ""}`.trim();

  if (navigator.share) {
    try {
      await navigator.share({
        title: state.currentResultProject.name,
        text: shareText
      });
      return;
    } catch {
      // silence
    }
  }

  await copyText(shareText);
}

function exportCurrentResult() {
  if (!state.currentResultProject) {
    showToast("Aucun résultat à exporter.");
    return;
  }

  downloadProjectJson(state.currentResultProject);
}

/* =========================
   Initialisation UI
========================= */
function bindNavigation() {
  profileButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const profile = button.dataset.profile;
      if (profile === "admin") {
        showView("view-admin-login");
      } else {
        await enterProfile(profile);
      }
    });
  });

  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = adminPasswordInput.value;

    if (password !== state.adminPassword) {
      showToast("Mot de passe incorrect.");
      return;
    }

    adminPasswordInput.value = "";
    await enterProfile("admin");
  });

  actionCards.forEach((card) => {
    card.addEventListener("click", async () => {
      const target = card.dataset.viewTarget;
      if (!target) return;
      if (!state.currentProfile) {
        showToast("Choisis un profil.");
        return;
      }

      if (target === "view-projects") {
        renderProjects();
      }

      if (target === "view-settings") {
        await refreshStorageStats();
      }

      showView(target);
    });
  });

  bottomTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const target = tab.dataset.viewTarget;
      if (!state.currentProfile) {
        showToast("Choisis un profil.");
        return;
      }

      if (target === "view-projects") renderProjects();
      if (target === "view-settings") await refreshStorageStats();

      showView(target);
    });
  });

  backButton.addEventListener("click", goBack);
  logoutButton.addEventListener("click", logoutProfile);
}

function bindTheme() {
  themeToggle.addEventListener("click", toggleTheme);
  settingsThemeToggle.addEventListener("click", toggleTheme);
}

function bindMusicProject() {
  musicAudioInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] || null;
    await handleMusicAudioSelection(file);
  });

  musicStartTime.addEventListener("input", updateMusicRangeLabels);
  musicEndTime.addEventListener("input", updateMusicRangeLabels);

  musicModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.musicMode = btn.dataset.musicMode;
      musicModeButtons.forEach((item) => {
        item.classList.toggle("active", item === btn);
      });
    });
  });

  musicStyleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.musicStyle = btn.dataset.musicStyle;
      musicStyleButtons.forEach((item) => {
        item.classList.toggle("active", item === btn);
      });
    });
  });

  musicCreateProjectBtn.addEventListener("click", createMusicProject);
}

function bindSpeechProject() {
  speechGenerateVoiceBtn.addEventListener("click", generateSpeechVoiceLocally);
  speechCreateProjectBtn.addEventListener("click", createSpeechProject);
}

function bindSoraHelper() {
  soraAudioInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] || null;
    await handleSoraAudioSelection(file);
  });

  soraStartTime.addEventListener("input", updateSoraRangeLabels);
  soraEndTime.addEventListener("input", updateSoraRangeLabels);

  soraDurationButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.soraDuration = Number(btn.dataset.soraDuration || 10);
      soraDurationButtons.forEach((item) => {
        item.classList.toggle("active", item === btn);
      });
    });
  });

  soraGeneratePromptsBtn.addEventListener("click", generateSoraPromptsProject);

  copyAllSoraPromptsBtn.addEventListener("click", async () => {
    if (!state.currentSoraProject?.prompts?.length) {
      showToast("Aucun prompt à copier.");
      return;
    }

    const text = state.currentSoraProject.prompts
      .map((item) => `Prompt ${item.index} - de ${formatSeconds(item.start)} à ${formatSeconds(item.end)}\n${item.text}`)
      .join("\n\n");

    await copyText(text);
  });
}

function bindLibraries() {
  musicImagesInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    await saveLibraryFiles(files, "music-library", "image");
    event.target.value = "";
  });

  musicVideosInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    await saveLibraryFiles(files, "music-library", "video");
    event.target.value = "";
  });

  speechImagesInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    await saveLibraryFiles(files, "speech-library", "image");
    event.target.value = "";
  });

  speechVideosInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    await saveLibraryFiles(files, "speech-library", "video");
    event.target.value = "";
  });
}

function bindProjectsAndSettings() {
  projectSearchInput.addEventListener("input", renderProjects);
  projectFilterSelect.addEventListener("change", renderProjects);

  storageRefreshBtn.addEventListener("click", refreshStorageStats);
  clearCacheBtn.addEventListener("click", clearCurrentProfileData);
}

function bindResultActions() {
  copyMainMetaBtn.addEventListener("click", async () => {
    await copyText(mainMetaOutput.textContent || "");
  });

  copyShortMetaBtn.addEventListener("click", async () => {
    await copyText(shortMetaOutput.textContent || "");
  });

  shareResultBtn.addEventListener("click", shareCurrentResult);
  exportResultBtn.addEventListener("click", exportCurrentResult);
}

/* =========================
   Chargement initial
========================= */
async function bootstrap() {
  await openDatabase();

  state.theme = await kvGet("theme", "dark");
  state.adminPassword = await kvGet("adminPassword", DEFAULT_ADMIN_PASSWORD);

  await applyTheme(state.theme);

  bindNavigation();
  bindTheme();
  bindMusicProject();
  bindSpeechProject();
  bindSoraHelper();
  bindLibraries();
  bindProjectsAndSettings();
  bindResultActions();

  showView("view-profile-select", false);
  updateBottomNavVisibility();
  updateBackButton();
  renderProjects();
  renderMusicLibrary();
  renderSpeechLibrary();
  await refreshStorageStats();
}

bootstrap().catch((error) => {
  console.error(error);
  showToast("Erreur au démarrage de l’application.");
});
