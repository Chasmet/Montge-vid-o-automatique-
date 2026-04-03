const API_BASE = window.API_BASE || "https://montge-vid-o-automatique.onrender.com";
const RESULT_STORAGE_KEY = "montage_ia_last_result_v2";

const UI_SELECTORS = {
  audioInput: ["#audioInput", 'input[type="file"][data-role="audio"]'],
  mediaInput: ["#mediaInput", 'input[type="file"][data-role="media"]'],
  titleInput: ["#titleInput", "#projectTitle", 'input[data-role="title"]'],
  contextInput: ["#contextInput", "#projectContext", 'textarea[data-role="context"]'],
  lyricsInput: ["#lyricsInput", "#lyricsText", 'textarea[data-role="lyrics"]'],
  aspectRatioInput: ["#aspectRatio", "#aspectRatioSelect", '[data-role="aspect-ratio"]'],
  startInput: ["#audioStartSec", "#startSec", 'input[data-role="audio-start"]'],
  endInput: ["#audioEndSec", "#endSec", 'input[data-role="audio-end"]'],
  targetDurationInput: ["#targetDurationSec", "#durationSec", 'input[data-role="target-duration"]'],

  processButton: ["#btnTraiter", "#processBtn", '[data-action="process"]'],
  redoButton: ["#btnRefaireVideo", '[data-action="redo-video"]'],
  downloadButton: ["#btnTelechargerVideo", '[data-action="download-video"]'],

  statusText: ["#statusRendu", '[data-role="render-status"]'],
  mediaCountText: ["#mediaCount", "#mediaCountText", '[data-role="media-count"]'],

  analysisBox: ["#analysisGemini", "#geminiAnalysis", '[data-role="analysis-gemini"]'],
  clipIdeasBox: ["#clipIdeasGemini", "#geminiClipIdeas", '[data-role="clip-ideas-gemini"]'],
  planBox: ["#planMontageIA", "#planMontage", '[data-role="plan-montage"]'],
  metaGeneralBox: ["#metaGeneral", '[data-role="meta-general"]'],
  metaShortsBox: ["#metaShorts", '[data-role="meta-shorts"]'],
  subtitlesBox: ["#subtitlesResult", '[data-role="subtitles-result"]'],
  warningsBox: ["#warningsResult", '[data-role="warnings-result"]'],

  videoPreview: ["#resultVideo", "video[data-role='result-video']"],
  videoSource: ["#resultVideoSource", "source[data-role='result-video-source']"]
};

const MontageApp = {
  lastRunInput: null,
  lastPrepared: null,
  lastVideoBlob: null,
  lastVideoUrl: "",
  lastResult: null
};

function firstEl(selectors) {
  for (const selector of selectors || []) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function getValue(selectors, fallback = "") {
  const el = firstEl(selectors);
  if (!el) return fallback;
  return (el.value ?? el.textContent ?? fallback).toString();
}

function setText(selectors, value) {
  const el = firstEl(selectors);
  if (!el) return;
  el.textContent = value ?? "";
}

function setHTML(selectors, html) {
  const el = firstEl(selectors);
  if (!el) return;
  el.innerHTML = html ?? "";
}

function setDisabled(selectors, disabled) {
  const el = firstEl(selectors);
  if (!el) return;
  el.disabled = !!disabled;
}

function escapeHtml(value) {
  return (value ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value) {
  return (value ?? "").toString().trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeId(prefix = "media") {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function pickMediaType(file) {
  const type = safeText(file?.type).toLowerCase();
  if (type.startsWith("image/")) return "image";
  return "video";
}

function normalizeCandidatesFromFiles(files) {
  return toArray(files).map((file, index) => ({
    id: makeId(`media_${index + 1}`),
    fileName: file.name || `media_${index + 1}`,
    label: file.name || `media_${index + 1}`,
    mediaType: pickMediaType(file),
    ratio: "",
    block: "",
    durationSec: 0
  }));
}

function formatList(items) {
  return toArray(items)
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(typeof item === "string" ? item : JSON.stringify(item))}</li>`)
    .join("");
}

function formatAnalysis(analysis) {
  if (!analysis || !Object.keys(analysis).length) {
    return `<div>Aucune analyse Gemini.</div>`;
  }

  const emotions = toArray(analysis.emotions);
  const hooks = toArray(analysis.hookMoments);
  const scenes = toArray(analysis.sceneIdeas);
  const lyrics = toArray(analysis.lyricsApprox || analysis.lyrics);

  return `
    <div><strong>Résumé :</strong> ${escapeHtml(analysis.summary || "Aucun résumé")}</div>
    <div><strong>Ambiance :</strong> ${escapeHtml(analysis.dominantMood || "Non précisée")}</div>
    <div><strong>Énergie :</strong> ${escapeHtml(analysis.energyLevel || "Non précisée")}</div>
    <div><strong>Rythme :</strong> ${escapeHtml(analysis.rhythmEstimate || "Non précisé")}</div>
    <div><strong>Univers :</strong> ${escapeHtml(analysis.visualUniverse || "Non précisé")}</div>
    ${emotions.length ? `<div><strong>Émotions :</strong><ul>${formatList(emotions)}</ul></div>` : ""}
    ${hooks.length ? `<div><strong>Moments forts :</strong><ul>${formatList(hooks)}</ul></div>` : ""}
    ${scenes.length ? `<div><strong>Idées de scènes :</strong><ul>${formatList(scenes)}</ul></div>` : ""}
    ${lyrics.length ? `<div><strong>Paroles estimées :</strong><ul>${formatList(lyrics)}</ul></div>` : ""}
  `;
}

function formatClipIdeas(clipIdeas) {
  if (!clipIdeas || !Object.keys(clipIdeas).length) {
    return `<div>Aucune idée de clip.</div>`;
  }

  return `
    <div><strong>Direction créative :</strong> ${escapeHtml(clipIdeas.creativeDirection || "Non précisée")}</div>
    <div><strong>Style visuel :</strong> ${escapeHtml(clipIdeas.visualStyle || "Non précisé")}</div>
    <div><strong>Style caméra :</strong> ${escapeHtml(clipIdeas.cameraStyle || "Non précisé")}</div>
    <div><strong>Palette :</strong> ${escapeHtml(clipIdeas.colorPalette || "Non précisée")}</div>
    ${toArray(clipIdeas.storyArc).length ? `<div><strong>Arc :</strong><ul>${formatList(clipIdeas.storyArc)}</ul></div>` : ""}
    ${toArray(clipIdeas.shortPromptIdeas).length ? `<div><strong>Prompts courts :</strong><ul>${formatList(clipIdeas.shortPromptIdeas)}</ul></div>` : ""}
  `;
}

function formatPlan(plan) {
  if (!plan || !toArray(plan.timeline).length) {
    return `<div>Aucun plan de montage.</div>`;
  }

  const items = plan.timeline.map((item, index) => {
    return `
      <li>
        <strong>Segment ${index + 1}</strong><br>
        média : ${escapeHtml(item.mediaId)}<br>
        de ${escapeHtml(item.start)}s à ${escapeHtml(item.end)}s<br>
        transition : ${escapeHtml(item.transition || "")}<br>
        effet : ${escapeHtml(item.effect || "")}
      </li>
    `;
  }).join("");

  return `
    <div><strong>Transition :</strong> ${escapeHtml(plan.transitionStyle || "fade")}</div>
    <div><strong>Effet :</strong> ${escapeHtml(plan.effectStyle || "clean")}</div>
    <div><strong>Médias liés :</strong> ${escapeHtml(String(toArray(plan.selectedMediaIds).length))}</div>
    <ul>${items}</ul>
  `;
}

function formatSubtitles(subtitles) {
  if (!subtitles || !subtitles.enabled) {
    return `<div>Aucun sous-titre.</div>`;
  }

  return `
    <div><strong>Segments :</strong> ${escapeHtml(String(toArray(subtitles.segments).length))}</div>
    <pre style="white-space: pre-wrap;">${escapeHtml(subtitles.srt || "")}</pre>
  `;
}

function formatWarnings(warnings) {
  const entries = Object.entries(warnings || {}).filter(([, value]) => safeText(value));
  if (!entries.length) return `<div>Aucun avertissement.</div>`;

  return `<ul>${entries.map(([key, value]) => `<li><strong>${escapeHtml(key)} :</strong> ${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function saveResult(result) {
  MontageApp.lastResult = result;
  localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
}

function loadResult() {
  try {
    const raw = localStorage.getItem(RESULT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setVideoPreview(url) {
  const video = firstEl(UI_SELECTORS.videoPreview);
  const source = firstEl(UI_SELECTORS.videoSource);

  if (!video && !source) return;

  if (source) {
    source.src = url || "";
    const parentVideo = source.closest("video");
    if (parentVideo) {
      parentVideo.load();
    }
  } else if (video) {
    video.src = url || "";
    video.load?.();
  }
}

function updateDownloadButton(url, fileName = "video.mp4") {
  const btn = firstEl(UI_SELECTORS.downloadButton);
  if (!btn) return;

  btn.dataset.downloadUrl = url || "";
  btn.dataset.fileName = fileName;
  btn.disabled = !url;
}

function hydrateResultScreen(result) {
  const data = result || loadResult() || {};
  MontageApp.lastResult = data;

  setText(UI_SELECTORS.statusText, data.renderStatus || "Vidéo prête");
  setText(UI_SELECTORS.mediaCountText, String(toArray(data.plan?.selectedMediaIds).length || toArray(data.input?.mediaFilesMeta).length || 0));

  setHTML(UI_SELECTORS.analysisBox, formatAnalysis(data.analysis));
  setHTML(UI_SELECTORS.clipIdeasBox, formatClipIdeas(data.clipIdeas));
  setHTML(UI_SELECTORS.planBox, formatPlan(data.plan));
  setHTML(UI_SELECTORS.metaGeneralBox, data.general ? `<pre style="white-space: pre-wrap;">${escapeHtml(data.general)}</pre>` : `<div>Aucune métadonnée.</div>`);
  setHTML(UI_SELECTORS.metaShortsBox, data.shorts ? `<pre style="white-space: pre-wrap;">${escapeHtml(data.shorts)}</pre>` : `<div>Aucune version courte.</div>`);
  setHTML(UI_SELECTORS.subtitlesBox, formatSubtitles(data.subtitles));
  setHTML(UI_SELECTORS.warningsBox, formatWarnings(data.warnings));

  if (MontageApp.lastVideoUrl) {
    setVideoPreview(MontageApp.lastVideoUrl);
    updateDownloadButton(MontageApp.lastVideoUrl, "montage-final.mp4");
  }
}

function getFilesFromInput(selectors) {
  const input = firstEl(selectors);
  if (!input || !input.files) return [];
  return Array.from(input.files);
}

function getAspectRatio() {
  const value = safeText(getValue(UI_SELECTORS.aspectRatioInput, "vertical")).toLowerCase();
  if (value === "horizontal") return "horizontal";
  return "vertical";
}

function collectInputFromDom() {
  const audioFiles = getFilesFromInput(UI_SELECTORS.audioInput);
  const mediaFiles = getFilesFromInput(UI_SELECTORS.mediaInput);

  const audioFile = audioFiles[0] || null;
  const candidates = normalizeCandidatesFromFiles(mediaFiles);

  const startSec = safeNumber(getValue(UI_SELECTORS.startInput, 0), 0);
  const endSec = safeNumber(getValue(UI_SELECTORS.endInput, 30), 30);
  const targetDuration = safeNumber(getValue(UI_SELECTORS.targetDurationInput, endSec - startSec || 30), endSec - startSec || 30);

  return {
    title: safeText(getValue(UI_SELECTORS.titleInput, "Projet musique")) || "Projet musique",
    context: safeText(getValue(UI_SELECTORS.contextInput, "")),
    lyricsText: safeText(getValue(UI_SELECTORS.lyricsInput, "")),
    projectType: "music",
    style: "social",
    tone: "normal",
    voiceStyle: "",
    mode: "video",
    aspectRatio: getAspectRatio(),
    mediaSourceMode: "multi",
    allowedBlocks: [],
    includeClipIdeas: true,
    forceGeminiSelection: false,
    audioStartSec: startSec,
    audioEndSec: endSec,
    targetDurationSec: targetDuration,
    audioFile,
    mediaFiles,
    candidates
  };
}

async function prepareProject(input) {
  if (!input?.audioFile) {
    throw new Error("Audio manquant côté application.");
  }

  const form = new FormData();
  form.append("audio", input.audioFile, input.audioFile.name || "audio.bin");
  form.append("title", input.title || "Projet musique");
  form.append("context", input.context || "");
  form.append("projectType", input.projectType || "music");
  form.append("style", input.style || "social");
  form.append("tone", input.tone || "normal");
  form.append("voiceStyle", input.voiceStyle || "");
  form.append("mode", input.mode || "video");
  form.append("aspectRatio", input.aspectRatio || "vertical");
  form.append("mediaSourceMode", input.mediaSourceMode || "multi");
  form.append("allowedBlocks", JSON.stringify(input.allowedBlocks || []));
  form.append("candidates", JSON.stringify(input.candidates || []));
  form.append("includeClipIdeas", String(!!input.includeClipIdeas));
  form.append("forceGeminiSelection", String(!!input.forceGeminiSelection));
  form.append("audioStartSec", String(input.audioStartSec ?? 0));
  form.append("audioEndSec", String(input.audioEndSec ?? 30));
  form.append("targetDurationSec", String(input.targetDurationSec ?? 30));
  form.append("lyricsText", input.lyricsText || "");

  const response = await fetch(`${API_BASE}/api/project/prepare`, {
    method: "POST",
    body: form
  });

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Erreur préparation projet.");
  }

  return data;
}

async function renderVideo(input, prepared) {
  const form = new FormData();

  form.append("audio", input.audioFile, input.audioFile.name || "audio.bin");

  for (const file of input.mediaFiles || []) {
    form.append("media", file, file.name || "media.bin");
  }

  form.append("title", input.title || "Projet musique");
  form.append("mode", input.mode || "video");
  form.append("aspectRatio", input.aspectRatio || "vertical");
  form.append("transitionStyle", prepared?.plan?.transitionStyle || "fade");
  form.append("effectStyle", prepared?.plan?.effectStyle || "clean");
  form.append("audioStartSec", String(input.audioStartSec ?? 0));
  form.append("audioEndSec", String(input.audioEndSec ?? 30));
  form.append("targetDurationSec", String(input.targetDurationSec ?? 30));
  form.append("mediaManifestJson", JSON.stringify(input.candidates || []));
  form.append("timelineJson", JSON.stringify(prepared?.plan?.timeline || []));

  const response = await fetch(`${API_BASE}/api/render/video`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    let message = "Erreur rendu vidéo.";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();
  return blob;
}

async function runFullWorkflow(input) {
  if (!input?.audioFile) {
    throw new Error("Sélectionne un audio.");
  }
  if (!toArray(input.mediaFiles).length) {
    throw new Error("Sélectionne au moins un média.");
  }

  setDisabled(UI_SELECTORS.processButton, true);
  setDisabled(UI_SELECTORS.redoButton, true);
  setText(UI_SELECTORS.statusText, "Analyse Gemini en cours...");

  try {
    MontageApp.lastRunInput = input;

    const prepared = await prepareProject(input);
    MontageApp.lastPrepared = prepared;

    const preResult = {
      ...prepared,
      renderStatus: "Préparation terminée",
      input: {
        title: input.title,
        mediaFilesMeta: input.candidates
      }
    };

    saveResult(preResult);
    hydrateResultScreen(preResult);

    setText(UI_SELECTORS.statusText, "Rendu vidéo en cours...");

    const videoBlob = await renderVideo(input, prepared);

    if (MontageApp.lastVideoUrl) {
      URL.revokeObjectURL(MontageApp.lastVideoUrl);
    }

    const videoUrl = URL.createObjectURL(videoBlob);
    MontageApp.lastVideoBlob = videoBlob;
    MontageApp.lastVideoUrl = videoUrl;

    const finalResult = {
      ...preResult,
      renderStatus: "Vidéo prête"
    };

    saveResult(finalResult);
    hydrateResultScreen(finalResult);
    setVideoPreview(videoUrl);
    updateDownloadButton(videoUrl, "montage-final.mp4");
    setDisabled(UI_SELECTORS.redoButton, false);

    return finalResult;
  } finally {
    setDisabled(UI_SELECTORS.processButton, false);
  }
}

async function redoLastVideo() {
  if (!MontageApp.lastRunInput || !MontageApp.lastPrepared) {
    throw new Error("Impossible de refaire la vidéo après rechargement. Recharge les fichiers puis relance.");
  }

  setDisabled(UI_SELECTORS.redoButton, true);
  setText(UI_SELECTORS.statusText, "Nouveau rendu en cours...");

  try {
    const videoBlob = await renderVideo(MontageApp.lastRunInput, MontageApp.lastPrepared);

    if (MontageApp.lastVideoUrl) {
      URL.revokeObjectURL(MontageApp.lastVideoUrl);
    }

    const videoUrl = URL.createObjectURL(videoBlob);
    MontageApp.lastVideoBlob = videoBlob;
    MontageApp.lastVideoUrl = videoUrl;

    const current = MontageApp.lastResult || loadResult() || {};
    const updated = {
      ...current,
      renderStatus: "Vidéo prête"
    };

    saveResult(updated);
    hydrateResultScreen(updated);
    setVideoPreview(videoUrl);
    updateDownloadButton(videoUrl, "montage-final.mp4");
  } finally {
    setDisabled(UI_SELECTORS.redoButton, false);
  }
}

function downloadLastVideo() {
  const btn = firstEl(UI_SELECTORS.downloadButton);
  const url = btn?.dataset?.downloadUrl || MontageApp.lastVideoUrl;
  const fileName = btn?.dataset?.fileName || "montage-final.mp4";

  if (!url) {
    alert("Aucune vidéo à télécharger.");
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function bindDefaultEvents() {
  const processBtn = firstEl(UI_SELECTORS.processButton);
  const redoBtn = firstEl(UI_SELECTORS.redoButton);
  const downloadBtn = firstEl(UI_SELECTORS.downloadButton);

  processBtn?.addEventListener("click", async () => {
    try {
      const input = collectInputFromDom();
      await runFullWorkflow(input);
    } catch (error) {
      setText(UI_SELECTORS.statusText, "Erreur");
      alert(error?.message || "Erreur traitement.");
    }
  });

  redoBtn?.addEventListener("click", async () => {
    try {
      await redoLastVideo();
    } catch (error) {
      alert(error?.message || "Erreur nouveau rendu.");
    }
  });

  downloadBtn?.addEventListener("click", () => {
    downloadLastVideo();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  hydrateResultScreen();
  bindDefaultEvents();
});

window.MontageAppFlow = {
  collectInputFromDom,
  prepareProject,
  renderVideo,
  runFullWorkflow,
  redoLastVideo,
  downloadLastVideo,
  hydrateResultScreen
};
