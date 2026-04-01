const APP_NAME = "Studio vidéo IA";
const DB_NAME = "montage-ia-mobile-v6";
const DB_VERSION = 1;
const ADMIN_PASSWORD_DEFAULT = "admin123";

const BACKEND_BASE_URL = "https://montge-vid-o-automatique.onrender.com";
const GEMINI_BACKEND_URL = "https://montge-vid-o-automatique-1.onrender.com";

const DEFAULT_MEDIA_BLOCKS = [
  "Animé / Manga", "Pixar / Cartoon", "Vrac", "Horreur",
  "Science-fiction / Fantaisie", "Moi", "Documentaire"
];

const DURATION_OPTIONS = ["10", "15", "20", "25", "30"];

const VOICE_FAMILY_LABELS = {
  naturel: "Naturel", emotion: "Émotion", dynamique: "Dynamique", special: "Spécial"
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
    musicAudioFile: null, musicAudioUrl: "", musicAudioDuration: 0,
    musicAnalyzing: false, musicIdeasLoading: false, musicPilotLoading: false,
    musicAnalysis: null, musicClipIdeas: null, musicMontagePlan: null,
    musicMetaGeneral: "", musicMetaShorts: "",
    musicDraft: {
      id: null, name: "", start: 0, end: 0, targetDuration: "30",
      style: "social", mode: "video", montageMode: "auto",
      aspectRatio: "vertical", mediaSourceMode: "single",
      primaryBlock: "Vrac", allowedBlocks: ["Vrac"], selectedMediaIds: []
    },
    speechAudioBlob: null, speechAudioUrl: "", speechMetaGeneral: "", speechMetaShorts: "",
    speechGenerating: false,
    speechDraft: {
      id: null, name: "", text: "", voiceFamily: "naturel", voiceStyle: "masculin-naturel",
      tone: "normal", speed: "1", mode: "video", montageMode: "auto",
      aspectRatio: "vertical", targetDuration: "30",
      mediaSourceMode: "single", primaryBlock: "Moi", allowedBlocks: ["Moi"], selectedMediaIds: []
    },
    soraAudioFile: null, soraAudioUrl: "", soraAudioDuration: 0,
    soraDraft: { id: null, name: "", start: 0, end: 0, style: "realisme" },
    soraDuration: 10, lastSoraPrompts: []
  },
  cache: { projects: [], media: [] }
};

let dbPromise = null;

// ==================== DB & Utils (identique à ton original) ====================
/* Copie-colle ici tout ton code original de openDb() jusqu’à detectFileOrientation() */
// (je ne le réécris pas ici pour gagner de la place, mais il doit rester EXACTEMENT comme avant)

// ==================== FONCTIONS CORRIGÉES (les 2 seules qui changent) ====================

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
    if (!state.temp.musicAnalysis) await analyzeMusicWithGemini();
    if (!state.temp.musicClipIdeas) await generateMusicClipIdeas();

    const candidates = mapMediaCandidatesForAi("music", draft);
    if (!candidates.length) throw new Error("Aucun média compatible.");

    const selection = await postGeminiJson("/api/gemini/select-media", {
      title, targetDurationSec: Number(draft.targetDuration || 30),
      aspectRatio: draft.aspectRatio, mediaSourceMode: draft.mediaSourceMode,
      allowedBlocks: getDraftBlocks(draft),
      analysis: state.temp.musicAnalysis, clipIdeas: state.temp.musicClipIdeas, candidates
    });

    let selectedMediaIds = Array.isArray(selection.selectedIds) && selection.selectedIds.length
      ? selection.selectedIds : candidates.slice(0, 6).map(item => item.id);

    const selectedCandidates = candidates.filter(item => selectedMediaIds.includes(item.id));

    const planRes = await postJson("/api/montage/plan", {
      projectType: "music", title, aspectRatio: draft.aspectRatio, style: draft.style,
      durationSec: Number(draft.targetDuration || 30),
      analysis: state.temp.musicAnalysis, clipIdeas: state.temp.musicClipIdeas,
      candidates: selectedCandidates
    });

    const plan = planRes.plan || null;
    state.temp.musicMontagePlan = plan;
    if (Array.isArray(plan?.selectedMediaIds) && plan.selectedMediaIds.length) {
      selectedMediaIds = plan.selectedMediaIds;
    }

    let generalMeta = safeText(planRes.general || "");
    let shortsMeta = safeText(planRes.shorts || "").slice(0, 100);
    if (!generalMeta || !shortsMeta) {
      const metaRes = await postJson("/api/meta/generate", {
        projectType: "music", title, style: draft.style, mode: draft.mode,
        tone: state.temp.musicAnalysis?.dominantMood || draft.style,
        analysis: state.temp.musicAnalysis, clipIdeas: state.temp.musicClipIdeas
      });
      generalMeta = safeText(metaRes.general || generalMeta);
      shortsMeta = safeText(metaRes.shorts || shortsMeta).slice(0, 100);
    }

    state.temp.musicDraft.selectedMediaIds = selectedMediaIds;
    state.temp.musicMetaGeneral = generalMeta;
    state.temp.musicMetaShorts = shortsMeta;

    await saveMusicDraft();
    await syncMusicAiToExistingProject();

    const project = await saveMusicProjectRecord();

    showToast("Plan de montage créé → Rendu vidéo automatique en cours...");

    await renderProjectVideo(project.id);   // ← rendu direct

    state.currentResultId = project.id;
    state.route = "result";
    render();

  } catch (error) {
    console.error(error);
    showToast(error.message || "Erreur pendant la création automatique du clip.");
  } finally {
    state.temp.musicPilotLoading = false;
    render();
  }
}

async function renderProjectVideo(projectId) {
  const project = state.cache.projects.find(p => p.id === projectId);
  if (!project) return showToast("Projet introuvable.");

  state.temp.renderBusyProjectId = project.id;
  render();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    await projectPut({ ...project, updatedAt: nowISO(), status: "Rendu en cours",
      config: { ...project.config, renderStatus: "processing", renderError: "" }
    });
    await hydrateCache(); render();

    const audioMediaId = project.type === "speech" ? project.config?.generatedAudioMediaId : project.config?.audioMediaId;
    const audioMedia = await mediaGetById(audioMediaId);
    if (!audioMedia?.blob) throw new Error("Audio principal introuvable.");

    const linkedMedia = getSelectedOrFallbackMedia(project);
    if (!linkedMedia.length) throw new Error("Aucun média lié.");

    let targetDurationSec = 0, audioStartSec = 0, audioEndSec = 0;
    if (project.type === "speech") {
      const speechTotal = await getBlobDuration(audioMedia.blob, "audio");
      targetDurationSec = Math.min(speechTotal || 0, Number(project.config?.targetDuration || 30));
      audioStartSec = 0; audioEndSec = targetDurationSec;
    } else {
      const configured = Math.max(0, Number(project.config?.audioEnd || 0) - Number(project.config?.audioStart || 0));
      targetDurationSec = Math.min(configured, Number(project.config?.targetDuration || 30));
      audioStartSec = Number(project.config?.audioStart || 0);
      audioEndSec = audioStartSec + targetDurationSec;
    }
    if (targetDurationSec <= 0) throw new Error("Durée audio invalide.");

    const mediaManifest = linkedMedia.map(m => ({ id: m.id, fileName: m.fileName, mediaType: m.mediaType }));
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
    formData.append("audio", audioMedia.blob, audioMedia.fileName || `${project.name}.mp3`);

    linkedMedia.forEach((media, i) => {
      const ext = media.mediaType === "image" ? ".jpg" : ".mp4";
      formData.append("media", media.blob, media.fileName || `media_\( {i+1} \){ext}`);
    });

    const response = await fetch(`${BACKEND_BASE_URL}/api/render/video`, {
      method: "POST", body: formData, signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Erreur serveur ${response.status}`);
    }

    const videoBlob = await response.blob();
    const renderedMedia = {
      id: uid("render_video"), owner: state.profile, bucket: "project-video",
      mediaType: "video", fileName: `${project.name.replace(/[^\w-]/g, "_")}.mp4`,
      mimeType: "video/mp4", size: videoBlob.size, createdAt: nowISO(),
      block: "Vrac", orientation: project.config?.aspectRatio === "horizontal" ? "horizontal" : "vertical",
      tags: [], blob: videoBlob
    };

    await mediaPut(renderedMedia);
    await projectPut({
      ...project, updatedAt: nowISO(), status: "Vidéo prête",
      config: { ...project.config, renderStatus: "done", renderError: "", finalVideoMediaId: renderedMedia.id }
    });

    await hydrateCache();
    showToast("✅ Vidéo générée avec succès !");

  } catch (error) {
    clearTimeout(timeoutId);
    console.error("❌ Render error :", error);
    const msg = error.name === "AbortError"
      ? "⏳ Le rendu a pris trop de temps (timeout). Essaie avec moins de médias."
      : error.message || "Erreur de rendu vidéo";

    await projectPut({
      ...project, updatedAt: nowISO(), status: "Erreur de rendu",
      config: { ...project.config, renderStatus: "error", renderError: msg }
    });
    await hydrateCache();
    showToast(msg);
  } finally {
    state.temp.renderBusyProjectId = null;
    render();
  }
}

// ==================== Le reste de ton code original (à partir d’ici) ====================
/* Colle ici tout le reste de ton script.js original (bindMusicProject, analyzeMusicWithGemini, etc.) */
/* Tout doit rester identique sauf les deux fonctions ci-dessus */

// (fin du fichier)
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
