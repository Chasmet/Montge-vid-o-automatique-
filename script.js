/* =========================================================
   STUDIO VIDÉO IA - VERSION PROFESSIONNELLE COMPLÈTE (V6.7)
   ========================================================= */

const APP_NAME = "Studio vidéo IA";
const DB_NAME = "montage-ia-mobile-v6";
const DB_VERSION = 1;
const ADMIN_PASSWORD_DEFAULT = "admin123";

// Backends
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
    { id: "masculin-triste", label: "Masculin triste" },
    { id: "feminin-triste", label: "Féminin triste" }
  ],
  dynamique: [
    { id: "masculin-pub", label: "Masculin Publicité" },
    { id: "feminin-pub", label: "Féminin Publicité" },
    { id: "masculin-info", label: "Masculin Info" },
    { id: "feminin-info", label: "Féminin Info" }
  ],
  special: [
    { id: "masculin-profond", label: "Grosse voix" },
    { id: "feminin-douce", label: "Murmure" },
    { id: "radio-old", label: "Radio Vintage" }
  ]
};

/* =========================
   State & DB
========================= */
let db = null;
const state = {
  theme: "theme-dark",
  adminPassword: "",
  profile: null,
  route: "profiles",
  history: [],
  currentResultId: null,
  customBlocks: [],
  mediaLibrary: [],
  
  temp: {
    speechText: "",
    speechVoice: "masculin-naturel",
    speechAudioUrl: "",
    speechSubtitles: null,
    speechAutoSubs: true,
    
    musicFile: null,
    musicAudioUrl: "",
    musicAnalysis: null,
    musicClipIdeas: null,
    musicMontagePlan: null,
    musicMetaGeneral: "",
    musicMetaShorts: "",
    
    soraPrompt: "",
    soraAudioUrl: "",
    lastSoraPrompts: []
  },
  
  ui: {
    loading: false,
    loadingMsg: "",
    sidebarOpen: false
  }
};

/* --- Database Engines --- */
async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("profiles")) d.createObjectStore("profiles", { keyPath: "id" });
      if (!d.objectStoreNames.contains("media")) d.createObjectStore("media", { keyPath: "id" });
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("history")) d.createObjectStore("history", { keyPath: "id" });
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(); };
    request.onerror = () => reject();
  });
}

async function kvGet(key, fallback) {
  return new Promise((res) => {
    if (!db) return res(fallback);
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => res(req.result !== undefined ? req.result : fallback);
    req.onerror = () => res(fallback);
  });
}

async function kvSet(key, val) {
  if (!db) return;
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(val, key);
}

/* =========================
   Utils & Helpers
========================= */
function showLoading(msg = "Chargement...") {
  state.ui.loading = true;
  state.ui.loadingMsg = msg;
  render();
}

function hideLoading() {
  state.ui.loading = false;
  render();
}

function resetObjectUrl(url) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function shuffleArray(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================
   Media Management
========================= */
async function hydrateCache() {
  if (!state.profile) {
    state.mediaLibrary = [];
    return;
  }
  return new Promise((res) => {
    const tx = db.transaction("media", "readonly");
    const store = tx.objectStore("media");
    const req = store.getAll();
    req.onsuccess = () => {
      state.mediaLibrary = req.result.filter(m => m.profileId === state.profile.id);
      res();
    };
  });
}

async function addMediaFiles(files, blockName) {
  if (!state.profile) return;
  showLoading("Ajout des médias...");
  const tx = db.transaction("media", "readwrite");
  const store = tx.objectStore("media");
  
  for (const f of files) {
    const id = "m_" + Math.random().toString(36).slice(2, 11);
    const isVideo = f.type.startsWith("video/");
    const mediaObj = {
      id,
      profileId: state.profile.id,
      name: f.name,
      type: isVideo ? "video" : "image",
      blob: f,
      block: blockName || "Vrac",
      date: Date.now()
    };
    store.add(mediaObj);
  }
  
  tx.oncomplete = async () => {
    await hydrateCache();
    hideLoading();
  };
}

async function deleteMedia(id) {
  const tx = db.transaction("media", "readwrite");
  tx.objectStore("media").delete(id);
  tx.oncomplete = async () => {
    await hydrateCache();
    render();
  };
}

/* =========================
   Logic: Speech (Voix IA)
========================= */
async function generateSpeechAudio() {
  if (!state.temp.speechText.trim()) return alert("Texte vide.");
  showLoading("Génération de la voix...");
  
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/speech/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.temp.speechText,
        voiceId: state.temp.speechVoice
      })
    });
    
    if (!res.ok) throw new Error("Erreur TTS");
    const blob = await res.blob();
    resetObjectUrl(state.temp.speechAudioUrl);
    state.temp.speechAudioUrl = URL.createObjectURL(blob);
    
    if (state.temp.speechAutoSubs) {
      await generateSpeechSubtitles();
    }
    
    await saveSpeechDraft();
    hideLoading();
  } catch (e) {
    console.error(e);
    hideLoading();
    alert("Erreur TTS.");
  }
}

async function generateSpeechSubtitles() {
  if (!state.temp.speechText.trim() || !state.temp.speechAudioUrl) return;
  showLoading("Calcul des sous-titres...");
  
  try {
    const audio = new Audio(state.temp.speechAudioUrl);
    await new Promise(r => {
      audio.onloadedmetadata = r;
      setTimeout(r, 2000); 
    });
    
    const duration = audio.duration || 30;

    const res = await fetch(`${BACKEND_BASE_URL}/api/subtitles/from-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.temp.speechText,
        totalDuration: duration
      })
    });
    
    const data = await res.json();
    if (data.ok) {
      state.temp.speechSubtitles = data.subtitles;
    }
    render();
    hideLoading();
  } catch (e) {
    console.error(e);
    hideLoading();
  }
}

async function saveSpeechDraft() {
  if (!state.profile) return;
  const draft = {
    text: state.temp.speechText,
    voice: state.temp.speechVoice,
    autoSubs: state.temp.speechAutoSubs
  };
  await kvSet(`draft_speech_${state.profile.id}`, draft);
}

async function loadSpeechDraft() {
  const d = await kvGet(`draft_speech_${state.profile.id}`, null);
  if (d) {
    state.temp.speechText = d.text || "";
    state.temp.speechVoice = d.voice || "masculin-naturel";
    state.temp.speechAutoSubs = d.autoSubs !== undefined ? d.autoSubs : true;
  }
}

/* =========================
   Logic: Music IA (Pilotage)
========================= */
async function handleMusicFile(input) {
  if (input.files && input.files[0]) {
    state.temp.musicFile = input.files[0];
    resetObjectUrl(state.temp.musicAudioUrl);
    state.temp.musicAudioUrl = URL.createObjectURL(input.files[0]);
    render();
  }
}

async function analyzeMusic() {
  if (!state.temp.musicFile) return alert("Pas de fichier.");
  showLoading("Analyse Gemini en cours...");
  
  try {
    const fd = new FormData();
    fd.append("audio", state.temp.musicFile);
    fd.append("title", state.temp.musicFile.name);
    
    const res = await fetch(`${GEMINI_BACKEND_URL}/api/gemini/analyze-audio`, {
      method: "POST",
      body: fd
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    
    state.temp.musicAnalysis = data.analysis;
    hideLoading();
  } catch (e) {
    hideLoading();
    alert("Erreur analyse.");
  }
}

async function generateClipIdeas() {
  if (!state.temp.musicAnalysis) return;
  showLoading("Idées créatives...");
  try {
    const res = await fetch(`${GEMINI_BACKEND_URL}/api/gemini/clip-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: state.temp.musicFile?.name || "Musique",
        analysis: state.temp.musicAnalysis
      })
    });
    const data = await res.json();
    state.temp.musicClipIdeas = data.result;
    hideLoading();
  } catch (e) {
    hideLoading();
  }
}

async function generateGeminiMontagePlan() {
  if (!state.temp.musicAnalysis || !state.mediaLibrary.length) return alert("Données manquantes.");
  showLoading("Sélection intelligente (Variété)...");
  
  try {
    const shuffledMedia = shuffleArray(state.mediaLibrary).map(m => ({
      id: m.id,
      label: m.name,
      block: m.block,
      type: m.type
    }));

    const res = await fetch(`${GEMINI_BACKEND_URL}/api/gemini/select-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Projet IA",
        analysis: state.temp.musicAnalysis,
        clipIdeas: state.temp.musicClipIdeas || {},
        candidates: shuffledMedia,
        targetDurationSec: 30,
        forceGeminiSelection: true
      })
    });
    
    const data = await res.json();
    if (data.ok) {
      state.temp.musicMontagePlan = {
        selectedIds: data.selectedIds,
        reasoning: data.reasoning
      };
    }
    await saveMusicDraft();
    hideLoading();
  } catch (e) {
    hideLoading();
  }
}

async function saveMusicDraft() {
  if (!state.profile) return;
  const draft = {
    analysis: state.temp.musicAnalysis,
    ideas: state.temp.musicClipIdeas,
    plan: state.temp.musicMontagePlan
  };
  await kvSet(`draft_music_${state.profile.id}`, draft);
}

async function loadMusicDraft() {
  const d = await kvGet(`draft_music_${state.profile.id}`, null);
  if (d) {
    state.temp.musicAnalysis = d.analysis;
    state.temp.musicClipIdeas = d.ideas;
    state.temp.musicMontagePlan = d.plan;
  }
}

/* =========================
   Logic: Sora (Vidéos IA)
========================= */
async function generateSoraVideo() {
  if (!state.temp.soraPrompt.trim()) return alert("Prompt vide.");
  showLoading("Génération Sora en cours...");
  // Logique Sora originale
  setTimeout(() => {
    alert("Simulation Sora : Vidéo générée (En attente d'API réelle)");
    hideLoading();
  }, 2000);
}

async function saveSoraDraft() {
  if (!state.profile) return;
  await kvSet(`draft_sora_${state.profile.id}`, { prompt: state.temp.soraPrompt });
}

async function loadSoraDraft() {
  const d = await kvGet(`draft_sora_${state.profile.id}`, null);
  if (d) state.temp.soraPrompt = d.prompt || "";
}

/* =========================
   RENDU FINAL (FFmpeg)
========================= */
async function startFullRender(mode) {
  showLoading("Orchestration FFmpeg...");
  try {
    const fd = new FormData();
    fd.append("profileId", state.profile.id);
    fd.append("mode", mode);

    if (mode === "speech") {
      const audioBlob = await fetch(state.temp.speechAudioUrl).then(r => r.blob());
      fd.append("audio", audioBlob, "voice.mp3");
      if (state.temp.speechSubtitles) fd.append("subtitles", JSON.stringify(state.temp.speechSubtitles));
      
      const pool = state.mediaLibrary.filter(m => m.block === "Moi" || m.block === "Vrac").slice(0, 10);
      pool.forEach((m, i) => fd.append(`media_${i}`, m.blob));
    } 
    else if (mode === "music") {
      fd.append("audio", state.temp.musicFile);
      fd.append("plan", JSON.stringify(state.temp.musicMontagePlan));
      state.temp.musicMontagePlan.selectedIds.forEach((id, i) => {
        const m = state.mediaLibrary.find(x => x.id === id);
        if (m) fd.append(`media_${i}`, m.blob);
      });
    }

    const res = await fetch(`${BACKEND_BASE_URL}/api/render/full`, { method: "POST", body: fd });
    const result = await res.json();
    hideLoading();
    if (result.ok) {
      alert("Vidéo envoyée au rendu !");
      state.route = "history";
      render();
    }
  } catch (e) {
    hideLoading();
    alert("Erreur serveur rendu.");
  }
}

/* =========================
   History & Admin
========================= */
async function loadHistory() {
  if (!state.profile) return;
  return new Promise(res => {
    const tx = db.transaction("history", "readonly");
    const req = tx.objectStore("history").getAll();
    req.onsuccess = () => {
      state.history = req.result.filter(h => h.profileId === state.profile.id).sort((a,b) => b.date - a.date);
      res();
    };
  });
}

async function loadCustomBlocks() {
  state.customBlocks = await kvGet(`blocks_${state.profile.id}`, []);
}

async function saveCustomBlocks() {
  await kvSet(`blocks_${state.profile.id}`, state.customBlocks);
}

/* =========================
   Templates UI (Partie 1)
========================= */
const Tpl = {
  profiles: () => `
    <div class="screen-profiles">
      <h1 class="logo-text">${APP_NAME}</h1>
      <div class="profile-grid" id="profileGrid"></div>
      <button class="btn-create-profile" onclick="createNewProfile()">+ Nouveau Profil</button>
      <div class="admin-access" onclick="state.route='admin-login';render();">⚙️</div>
    </div>
  `,
  
  dashboard: () => `
    <div class="dashboard-screen">
      <div class="dash-header">
        <h2>Studio de ${state.profile.name}</h2>
        <p>${state.mediaLibrary.length} médias en stock</p>
      </div>
      <div class="dash-grid">
        <div class="dash-item" onclick="state.route='media';render();">
          <div class="icon">📂</div>
          <span>Bibliothèque</span>
        </div>
        <div class="dash-item" onclick="state.route='speech';render();">
          <div class="icon">🎙️</div>
          <span>Voix IA</span>
        </div>
        <div class="dash-item" onclick="state.route='music';render();">
          <div class="icon">🎵</div>
          <span>Pilotage Musique</span>
        </div>
        <div class="dash-item" onclick="state.route='sora';render();">
          <div class="icon">✨</div>
          <span>Sora IA</span>
        </div>
        <div class="dash-item" onclick="state.route='history';render();">
          <div class="icon">🎬</div>
          <span>Mes Créations</span>
        </div>
      </div>
    </div>
  `,

  media: () => `
    <div class="tool-screen">
      <div class="tool-header">
        <button class="btn-icon" onclick="state.route='dashboard';render();">←</button>
        <h3>Ma Bibliothèque</h3>
      </div>
      <div class="media-controls">
        <select id="uploadBlock">
          ${[...DEFAULT_MEDIA_BLOCKS, ...state.customBlocks].map(b => `<option value="${b}">${b}</option>`).join('')}
        </select>
        <input type="file" multiple id="fileInput" hidden onchange="handleMediaUpload(this)">
        <button class="btn-primary" onclick="document.getElementById('fileInput').click()">+ Ajouter</button>
      </div>
      <div class="library-list">
        ${state.mediaLibrary.map(m => `
          <div class="lib-item">
            <span>${m.name} (${m.block})</span>
            <button onclick="deleteMedia('${m.id}')">🗑️</button>
          </div>
        `).join('')}
      </div>
    </div>
  `,

  speech: () => `
    <div class="tool-screen">
      <div class="tool-header">
        <button class="btn-icon" onclick="state.route='dashboard';render();">←</button>
        <h3>🎙️ Voix IA</h3>
      </div>
      <div class="card">
        <label>Ton texte</label>
        <textarea id="spText" oninput="state.temp.speechText=this.value;saveSpeechDraft()">${state.temp.speechText}</textarea>
        
        <label>Voix</label>
        <select id="spVoice" onchange="state.temp.speechVoice=this.value;saveSpeechDraft()">
          ${Object.entries(VOICE_STYLE_GROUPS).map(([fam, voices]) => `
            <optgroup label="${VOICE_FAMILY_LABELS[fam]}">
              ${voices.map(v => `<option value="${v.id}" ${state.temp.speechVoice === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}
            </optgroup>
          `).join('')}
        </select>

        <div class="row-toggle">
          <input type="checkbox" id="spAuto" ${state.temp.speechAutoSubs ? 'checked' : ''} onchange="state.temp.speechAutoSubs=this.checked;saveSpeechDraft()">
          <label for="spAuto">Sous-titres automatiques</label>
        </div>

        <button class="btn-primary" onclick="generateSpeechAudio()">1. Générer l'audio</button>
      </div>

      ${state.temp.speechAudioUrl ? `
        <div class="card result">
          <audio src="${state.temp.speechAudioUrl}" controls></audio>
          <div class="btn-group">
            <button class="btn-secondary" onclick="generateSpeechSubtitles()">🔄 Sous-titres</button>
            <button class="btn-render" onclick="startFullRender('speech')">2. Créer Vidéo</button>
          </div>
          ${state.temp.speechSubtitles ? `<div class="sub-badge">✅ Sous-titres synchronisés</div>` : ''}
        </div>
      ` : ''}
    </div>
  `,

  music: () => `
    <div class="tool-screen">
      <div class="tool-header">
        <button class="btn-icon" onclick="state.route='dashboard';render();">←</button>
        <h3>🎵 Pilotage Musique</h3>
      </div>
      <div class="card">
        <label>Importer Musique</label>
        <input type="file" accept="audio/*" onchange="handleMusicFile(this)">
        ${state.temp.musicAudioUrl ? `<audio src="${state.temp.musicAudioUrl}" controls></audio>` : ''}
        <button class="btn-primary" onclick="analyzeMusic()">1. Analyser avec Gemini</button>
      </div>

      ${state.temp.musicAnalysis ? `
        <div class="card">
          <p>Ambiance : ${state.temp.musicAnalysis.dominantMood}</p>
          <button class="btn-secondary" onclick="generateClipIdeas()">2. Idées Créatives</button>
        </div>
      ` : ''}

      ${state.temp.musicClipIdeas ? `
        <div class="card">
          <p>${state.temp.musicClipIdeas.visualStyle}</p>
          <button class="btn-primary" onclick="generateGeminiMontagePlan()">3. Sélectionner Médias</button>
        </div>
      ` : ''}

      ${state.temp.musicMontagePlan ? `
        <div class="card result">
          <p>${state.temp.musicMontagePlan.selectedIds.length} médias choisis par l'IA.</p>
          <button class="btn-render" onclick="startFullRender('music')">Lancer le Montage</button>
        </div>
      ` : ''}
    </div>
  `,

  history: () => `
    <div class="tool-screen">
      <div class="tool-header">
        <button class="btn-icon" onclick="state.route='dashboard';render();">←</button>
        <h3>Mes Créations</h3>
      </div>
      <div class="history-list">
        ${state.history.length === 0 ? '<p>Aucune vidéo pour le moment.</p>' : 
          state.history.map(h => `
            <div class="hist-item">
              <span>Vidéo du ${new Date(h.date).toLocaleDateString()}</span>
              <button onclick="viewResult('${h.id}')">Voir</button>
            </div>
          `).join('')}
      </div>
    </div>
  `,

  "admin-login": () => `
    <div class="screen-login">
      <h3>Accès Admin</h3>
      <input type="password" id="admPass" placeholder="Code...">
      <button class="btn-primary" onclick="checkAdmin()">Entrer</button>
      <button class="btn-text" onclick="state.route='profiles';render();">Retour</button>
    </div>
  `,

  admin: () => `
    <div class="tool-screen">
      <div class="tool-header">
        <button class="btn-icon" onclick="state.route='profiles';render();">←</button>
        <h3>Réglages Système</h3>
      </div>
      <div class="card">
        <h4>Thème</h4>
        <select onchange="updateTheme(this.value)">
          <option value="theme-dark" ${state.theme==='theme-dark'?'selected':''}>Sombre</option>
          <option value="theme-light" ${state.theme==='theme-light'?'selected':''}>Clair</option>
        </select>
      </div>
      <div class="card">
        <h4>Réinitialisation</h4>
        <button class="btn-danger" onclick="fullReset()">⚠️ Effacer toute la base</button>
      </div>
    </div>
  `
};

/* =========================
   Event Handlers & Core
========================= */
async function handleMediaUpload(input) {
  const block = document.getElementById("uploadBlock").value;
  if (input.files.length) {
    await addMediaFiles(input.files, block);
    input.value = "";
  }
}

async function createNewProfile() {
  const name = prompt("Nom du profil ?");
  if (!name) return;
  const p = { id: "p_" + Date.now(), name, created: Date.now() };
  const tx = db.transaction("profiles", "readwrite");
  tx.objectStore("profiles").add(p);
  tx.oncomplete = () => renderProfiles();
}

async function enterProfile(profile) {
  state.profile = profile;
  await hydrateCache();
  await loadCustomBlocks();
  await loadSpeechDraft();
  await loadMusicDraft();
  await loadHistory();
  state.route = "dashboard";
  render();
}

async function renderProfiles() {
  const tx = db.transaction("profiles", "readonly");
  tx.objectStore("profiles").getAll().onsuccess = (e) => {
    const list = e.target.result;
    const grid = document.getElementById("profileGrid");
    if (!grid) return;
    grid.innerHTML = list.map(p => `
      <div class="profile-card" onclick='enterProfile(${JSON.stringify(p)})'>
        <div class="avatar">${p.name[0]}</div>
        <span>${p.name}</span>
      </div>
    `).join('');
  };
}

function updateTheme(val) {
  state.theme = val;
  kvSet("theme", val);
  render();
}

async function fullReset() {
  if (!confirm("Tout effacer ?")) return;
  indexedDB.deleteDatabase(DB_NAME);
  location.reload();
}

function checkAdmin() {
  const p = document.getElementById("admPass").value;
  if (p === state.adminPassword) {
    state.route = "admin";
    render();
  } else {
    alert("Code incorrect");
  }
}

/* =========================
   Rendering & Init
========================= */
function render() {
  const app = document.getElementById("app");
  const loader = document.getElementById("loader");
  const loaderMsg = document.getElementById("loaderMsg");

  // Loader
  if (state.ui.loading) {
    loader.style.display = "flex";
    loaderMsg.innerText = state.ui.loadingMsg;
  } else {
    loader.style.display = "none";
  }

  // Theme
  document.body.className = state.theme;

  // Routes
  if (state.route === "profiles") {
    app.innerHTML = Tpl.profiles();
    renderProfiles();
  } else {
    app.innerHTML = Tpl[state.route] ? Tpl[state.route]() : "Route non trouvée";
  }
}

async function bootstrap() {
  await openDb();
  state.theme = await kvGet("theme", "theme-dark");
  state.adminPassword = await kvGet("adminPassword", ADMIN_PASSWORD_DEFAULT);
  render();
}

window.onload = bootstrap;
