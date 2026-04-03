import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { Blob } from "buffer";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  process.env.OPENAI_TEXT_MODEL ||
  "gpt-4.1-mini";

const TTS_MODEL =
  process.env.TTS_MODEL ||
  process.env.OPENAI_TTS_MODEL ||
  "gpt-4o-mini-tts";

const GEMINI_SERVER_URL = safeUrl(process.env.GEMINI_SERVER_URL || "");
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
const ENABLE_GEMINI_ANALYSIS = envBool(process.env.ENABLE_GEMINI_ANALYSIS, true);
const ENABLE_GEMINI_CLIP_IDEAS = envBool(process.env.ENABLE_GEMINI_CLIP_IDEAS, true);
const ENABLE_GEMINI_SELECT_MEDIA = envBool(process.env.ENABLE_GEMINI_SELECT_MEDIA, true);
const ENABLE_PROJECT_CACHE = envBool(process.env.ENABLE_PROJECT_CACHE, true);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 6 * 60 * 60 * 1000);

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-mobile");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 300 * 1024 * 1024,
    files: 80
  }
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* =========================
   Utils
========================= */
function safeUrl(value) {
  return (value || "").toString().trim().replace(/\/+$/, "");
}

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "non", "off"].includes(normalized)) return false;
  return fallback;
}

function reqId() {
  return Math.random().toString(36).slice(2, 8);
}

app.use((req, _res, next) => {
  req.reqId = reqId();
  console.log(`[${req.reqId}] ${req.method} ${req.originalUrl}`);
  next();
});

function log(id, message, extra = "") {
  console.log(`[${id}] ${message}${extra ? ` ${extra}` : ""}`);
}

function safeText(value) {
  return (value || "").toString().trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonSafe(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseArraySafe(value, fallback = []) {
  if (Array.isArray(value)) return value;
  const parsed = parseJsonSafe(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function parseObjectSafe(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const parsed = parseJsonSafe(value, fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : fallback;
}

function parseBooleanish(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "non", "off"].includes(normalized)) return false;
  return fallback;
}

function slugTag(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function sha1(input) {
  return createHash("sha1").update(input).digest("hex");
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function removePathQuietly(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {}
}

async function removeManyQuietly(paths) {
  for (const p of paths || []) {
    await removePathQuietly(p);
  }
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/* =========================
   Cache mémoire
========================= */
const projectCache = new Map();

function getCache(key) {
  if (!ENABLE_PROJECT_CACHE || !key) return null;

  const item = projectCache.get(key);
  if (!item) return null;

  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    projectCache.delete(key);
    return null;
  }

  return cloneJson(item.data);
}

function setCache(key, data) {
  if (!ENABLE_PROJECT_CACHE || !key) return;
  projectCache.set(key, {
    createdAt: Date.now(),
    data: cloneJson(data)
  });
}

function cleanupCache() {
  if (!ENABLE_PROJECT_CACHE) return;
  const now = Date.now();
  for (const [key, item] of projectCache.entries()) {
    if (now - item.createdAt > CACHE_TTL_MS) {
      projectCache.delete(key);
    }
  }
}

setInterval(cleanupCache, 10 * 60 * 1000).unref?.();

/* =========================
   Gemini helpers
========================= */
function isGeminiConfigured() {
  return !!GEMINI_SERVER_URL;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await response.json();
  }

  const text = await response.text();
  return parseJsonSafe(text, { raw: text });
}

function compactCandidatesForGemini(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && item.id)
    .map((item, index) => ({
      id: item.id,
      order: index + 1,
      mediaType: safeText(item.mediaType || item.type || "video") || "video",
      ratio: safeText(item.ratio || item.aspectRatio || ""),
      block: safeText(item.block || item.collection || item.category || item.group || ""),
      durationSec: safeNumber(item.durationSec || item.duration || 0, 0),
      label: safeText(item.label || item.name || item.fileName || "")
    }));
}

function chooseCandidatesByIds(candidates = [], selectedIds = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ids = Array.isArray(selectedIds) ? selectedIds.map(String) : [];

  const ordered = ids
    .map((id) => list.find((item) => String(item?.id) === id))
    .filter(Boolean);

  return ordered.length ? ordered : list;
}

function buildDiversifiedFallbackCandidates(candidates = [], maxCount = 6) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item && item.id);
  if (!list.length) return [];

  const result = [];
  const usedIds = new Set();
  const usedBlocks = new Set();

  for (const item of list) {
    const id = String(item.id);
    const block = safeText(item.block || item.collection || item.category || item.group || "vrac").toLowerCase();

    if (usedIds.has(id)) continue;
    if (usedBlocks.has(block) && usedBlocks.size < maxCount) continue;

    result.push(item);
    usedIds.add(id);
    usedBlocks.add(block);

    if (result.length >= maxCount) return result;
  }

  for (const item of list) {
    const id = String(item.id);
    if (usedIds.has(id)) continue;
    result.push(item);
    usedIds.add(id);
    if (result.length >= maxCount) return result;
  }

  return result;
}

function shouldUseGeminiSelection({
  candidates = [],
  forceGeminiSelection = false
}) {
  if (!isGeminiConfigured() || !ENABLE_GEMINI_SELECT_MEDIA) return false;
  if (!Array.isArray(candidates) || candidates.length <= 1) return false;
  if (forceGeminiSelection) return true;
  return true;
}

async function callGeminiAnalyzeAudio({
  audioPath,
  audioName = "audio.bin",
  audioMimeType = "audio/mpeg",
  title = "Projet musique",
  context = "",
  id = "gemini"
}) {
  if (!ENABLE_GEMINI_ANALYSIS) {
    log(id, "GEMINI ANALYZE SKIP", "désactivé");
    return { ok: false, skipped: true, analysis: {} };
  }

  if (!isGeminiConfigured()) {
    log(id, "GEMINI ANALYZE SKIP", "serveur non configuré");
    return { ok: false, skipped: true, analysis: {} };
  }

  const buffer = await fsp.readFile(audioPath);
  const audioHash = sha1(buffer);
  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-analyze-audio",
      title,
      context,
      audioHash
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI ANALYZE CACHE HIT", title);
    return { ok: true, source: "cache", analysis: cached };
  }

  log(id, "GEMINI ANALYZE START", title);

  const form = new FormData();
  form.append("title", title);
  form.append("context", context);
  form.append("audio", new Blob([buffer], { type: audioMimeType }), audioName);

  const response = await fetchWithTimeout(
    `${GEMINI_SERVER_URL}/api/gemini/analyze-audio`,
    {
      method: "POST",
      body: form
    },
    GEMINI_TIMEOUT_MS
  );

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || "Erreur appel Gemini analyze-audio."
    );
  }

  const analysis = payload?.analysis || {};
  setCache(cacheKey, analysis);

  log(id, "GEMINI ANALYZE OK", title);

  return {
    ok: true,
    source: "gemini",
    analysis
  };
}

async function callGeminiClipIdeas({
  title = "Projet musique",
  context = "",
  analysis = {},
  id = "gemini"
}) {
  if (!ENABLE_GEMINI_CLIP_IDEAS) {
    log(id, "GEMINI CLIP IDEAS SKIP", "désactivé");
    return { ok: false, skipped: true, result: {} };
  }

  if (!isGeminiConfigured()) {
    log(id, "GEMINI CLIP IDEAS SKIP", "serveur non configuré");
    return { ok: false, skipped: true, result: {} };
  }

  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-clip-ideas",
      title,
      context,
      analysis
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI CLIP IDEAS CACHE HIT", title);
    return { ok: true, source: "cache", result: cached };
  }

  log(id, "GEMINI CLIP IDEAS START", title);

  const response = await fetchWithTimeout(
    `${GEMINI_SERVER_URL}/api/gemini/clip-ideas`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        context,
        analysis
      })
    },
    GEMINI_TIMEOUT_MS
  );

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || "Erreur appel Gemini clip-ideas."
    );
  }

  const result = payload?.result || {};
  setCache(cacheKey, result);

  log(id, "GEMINI CLIP IDEAS OK", title);

  return {
    ok: true,
    source: "gemini",
    result
  };
}

async function callGeminiSelectMedia({
  title = "Projet",
  targetDurationSec = 30,
  aspectRatio = "vertical",
  mediaSourceMode = "single",
  allowedBlocks = [],
  analysis = {},
  clipIdeas = {},
  candidates = [],
  id = "gemini"
}) {
  if (!ENABLE_GEMINI_SELECT_MEDIA) {
    log(id, "GEMINI SELECT SKIP", "désactivé");
    return {
      ok: false,
      skipped: true,
      selectedIds: [],
      reasoning: ""
    };
  }

  if (!isGeminiConfigured()) {
    log(id, "GEMINI SELECT SKIP", "serveur non configuré");
    return {
      ok: false,
      skipped: true,
      selectedIds: [],
      reasoning: ""
    };
  }

  const compactCandidates = compactCandidatesForGemini(candidates);

  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-select-media",
      title,
      targetDurationSec,
      aspectRatio,
      mediaSourceMode,
      allowedBlocks,
      analysis,
      clipIdeas,
      compactCandidates
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI SELECT CACHE HIT", `${title} / ${compactCandidates.length}`);
    return {
      ok: true,
      source: "cache",
      selectedIds: cached?.selectedIds || [],
      reasoning: safeText(cached?.reasoning || "")
    };
  }

  log(id, "GEMINI SELECT START", `${title} / ${compactCandidates.length} candidats`);

  const response = await fetchWithTimeout(
    `${GEMINI_SERVER_URL}/api/gemini/select-media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        targetDurationSec,
        aspectRatio,
        mediaSourceMode,
        allowedBlocks,
        analysis,
        clipIdeas,
        candidates: compactCandidates
      })
    },
    GEMINI_TIMEOUT_MS
  );

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || "Erreur appel Gemini select-media."
    );
  }

  const result = {
    selectedIds: Array.isArray(payload?.selectedIds) ? payload.selectedIds : [],
    reasoning: safeText(payload?.reasoning || "")
  };

  setCache(cacheKey, result);

  log(id, "GEMINI SELECT OK", `${title} / ${result.selectedIds.length} ids`);

  return {
    ok: true,
    source: "gemini",
    ...result
  };
}

/* =========================
   Local text / meta / subtitles
========================= */
function buildGeminiBasedMeta({
  title = "Projet",
  projectType = "media",
  style = "créatif",
  tone = "normal",
  voiceStyle = "",
  mode = "video",
  analysis = null,
  clipIdeas = null
}) {
  const cleanTitle = safeText(title) || "Projet";

  const summary = safeText(
    clipIdeas?.creativeDirection ||
      analysis?.summary ||
      `Création ${projectType} ${style}`
  );

  const mood = safeText(
    analysis?.dominantMood || tone || style || "créatif"
  );

  const visual = safeText(
    clipIdeas?.visualStyle ||
      analysis?.visualUniverse ||
      style ||
      "cinematique"
  );

  const camera = safeText(clipIdeas?.cameraStyle || "");
  const voice = safeText(voiceStyle || "");
  const palette = safeText(clipIdeas?.colorPalette || "");
  const rhythm = safeText(analysis?.rhythmEstimate || "");

  const tags = [
    projectType === "speech" ? "#voixia" : "#clipmusical",
    "#montageia",
    mood ? `#${slugTag(mood)}` : "",
    visual ? `#${slugTag(visual)}` : "",
    mode === "video" ? "#video" : "#image"
  ].filter(Boolean);

  const descriptionParts = [
    summary,
    mood ? `Ambiance : ${mood}.` : "",
    visual ? `Univers visuel : ${visual}.` : "",
    camera ? `Caméra : ${camera}.` : "",
    palette ? `Palette : ${palette}.` : "",
    rhythm ? `Rythme : ${rhythm}.` : "",
    projectType === "speech" && voice ? `Voix : ${voice}.` : ""
  ].filter(Boolean);

  const general = `${cleanTitle}
${descriptionParts.join(" ")}
${tags.join(" ")}`;

  const shortTags = [
    projectType === "speech" ? "#voixia" : "#clipmusical",
    "#montageia",
    mood ? `#${slugTag(mood)}` : ""
  ].filter(Boolean);

  const shorts = `${cleanTitle}
${shortTags.join(" ")}`.slice(0, 100);

  return { general, shorts };
}

function normalizeLyricsLines(input) {
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          if (typeof item.text === "string") return [item.text];
          if (typeof item.line === "string") return [item.line];
        }
        return [];
      })
      .map((line) => safeText(line))
      .filter(Boolean);
  }

  const text = safeText(input);
  if (!text) return [];

  return text
    .split(/\r?\n+/)
    .map((line) => safeText(line))
    .filter(Boolean);
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");

  return `${hh}:${mm}:${ss},${mmm}`;
}

function buildSubtitlePayload({
  lyricsText = "",
  lyricsApprox = [],
  startSec = 0,
  endSec = 30
}) {
  const lines = normalizeLyricsLines(lyricsText).length
    ? normalizeLyricsLines(lyricsText)
    : normalizeLyricsLines(lyricsApprox);

  const duration = Math.max(0, Number(endSec || 0) - Number(startSec || 0));

  if (!lines.length || duration <= 0) {
    return {
      enabled: false,
      plainText: "",
      segments: [],
      srt: ""
    };
  }

  const weights = lines.map((line) => Math.max(1, safeText(line).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || lines.length;

  let cursor = Number(startSec || 0);
  const rawSegments = lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const share = weights[index] / totalWeight;
    const wantedDuration = duration * share;
    const segmentDuration = isLast
      ? Number((Number(endSec || 0) - cursor).toFixed(3))
      : Number(wantedDuration.toFixed(3));

    const segment = {
      index: index + 1,
      start: Number(cursor.toFixed(3)),
      end: Number((cursor + segmentDuration).toFixed(3)),
      text: line
    };

    cursor = segment.end;
    return segment;
  });

  if (rawSegments.length) {
    rawSegments[rawSegments.length - 1].end = Number(Number(endSec || 0).toFixed(3));
  }

  const segments = rawSegments
    .filter((item) => item.end > item.start && safeText(item.text))
    .map((item, index) => ({
      index: index + 1,
      start: item.start,
      end: item.end,
      text: item.text
    }));

  const srt = segments
    .map(
      (item) =>
        `${item.index}
${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}
${item.text}`
    )
    .join("\n\n");

  return {
    enabled: true,
    plainText: segments.map((item) => item.text).join("\n"),
    segments,
    srt
  };
}

function buildLocalSoraPrompts({
  title = "Projet vidéo",
  start = 0,
  end = 10,
  segmentDuration = 10,
  style = "realisme",
  universe = "",
  notes = "",
  lyricsExcerpt = "",
  analysis = {},
  clipIdeas = {}
}) {
  const prompts = [];
  let cursor = Number(start || 0);
  let index = 1;

  const cleanTitle = safeText(title) || "Projet vidéo";
  const cleanStyle = safeText(style) || "realisme";
  const cleanUniverse =
    safeText(universe) ||
    safeText(clipIdeas?.visualStyle) ||
    safeText(analysis?.visualUniverse);
  const cleanNotes =
    safeText(notes) ||
    safeText(clipIdeas?.creativeDirection) ||
    safeText(analysis?.soraDirection);
  const cleanLyrics = safeText(lyricsExcerpt);
  const cleanCamera = safeText(clipIdeas?.cameraStyle || "");
  const cleanMood = safeText(analysis?.dominantMood || "");

  while (cursor < end) {
    const next = Math.min(end, cursor + segmentDuration);

    const pieces = [
      `Scène ${index} pour "${cleanTitle}"`,
      `style ${cleanStyle}`,
      "rendu cinématographique cohérent",
      "continuité visuelle avec la scène précédente",
      cleanUniverse ? `univers : ${cleanUniverse}` : "",
      cleanMood ? `ambiance : ${cleanMood}` : "",
      cleanCamera ? `caméra : ${cleanCamera}` : "",
      cleanNotes ? `direction : ${cleanNotes}` : "",
      cleanLyrics ? `paroles ou intention : ${cleanLyrics}` : "",
      `moment de ${cursor}s à ${next}s`
    ].filter(Boolean);

    prompts.push({
      index,
      start: cursor,
      end: next,
      prompt: pieces.join(", ") + "."
    });

    cursor = next;
    index += 1;
  }

  return prompts;
}

/* =========================
   OpenAI voice only
========================= */
function pickVoice(voiceFamily, voiceStyle, tone) {
  const key = `${voiceFamily}|${voiceStyle}|${tone}`;

  const map = {
    "naturel|masculin-naturel|normal": {
      voice: "alloy",
      instructions: "Voix masculine naturelle, claire, posée."
    },
    "naturel|feminin-naturel|normal": {
      voice: "nova",
      instructions: "Voix féminine naturelle, douce, claire."
    },
    "naturel|masculin-mature|normal": {
      voice: "onyx",
      instructions: "Voix masculine mature, grave, rassurante."
    },
    "naturel|feminin-mature|normal": {
      voice: "shimmer",
      instructions: "Voix féminine mature, posée, élégante."
    },
    "emotion|masculin-emotion|emotion": {
      voice: "ash",
      instructions: "Voix masculine émotionnelle, sincère, touchante."
    },
    "emotion|feminin-emotion|emotion": {
      voice: "coral",
      instructions: "Voix féminine émotionnelle, sensible, vibrante."
    },
    "emotion|voix-douce|calm": {
      voice: "shimmer",
      instructions: "Voix douce, calme, enveloppante."
    },
    "emotion|voix-sombre|emotion": {
      voice: "onyx",
      instructions: "Voix sombre, intense, dramatique."
    },
    "dynamique|masculin-energetique|energetic": {
      voice: "echo",
      instructions: "Voix masculine énergique, punchy, vivante."
    },
    "dynamique|feminin-dynamique|energetic": {
      voice: "ballad",
      instructions: "Voix féminine dynamique, assurée, vive."
    },
    "dynamique|voix-punchy|energetic": {
      voice: "echo",
      instructions: "Voix percutante, directe, rythmée."
    },
    "dynamique|voix-annonce|normal": {
      voice: "sage",
      instructions: "Voix annonce, claire, puissante, propre."
    },
    "special|voix-robot|normal": {
      voice: "verse",
      instructions: "Voix robotisée légère, précise, futuriste."
    },
    "special|voix-ia-futuriste|normal": {
      voice: "verse",
      instructions: "Voix IA futuriste, propre, stylisée."
    },
    "special|voix-mysterieuse|emotion": {
      voice: "fable",
      instructions: "Voix mystérieuse, cinématographique, intrigante."
    },
    "special|voix-froide|calm": {
      voice: "sage",
      instructions: "Voix froide, distante, maîtrisée."
    }
  };

  if (map[key]) return map[key];

  if (tone === "energetic") {
    return { voice: "echo", instructions: "Voix énergique, claire, rythmée." };
  }

  if (tone === "emotion") {
    return {
      voice: "coral",
      instructions: "Voix émotionnelle, sincère, expressive."
    };
  }

  if (tone === "calm") {
    return { voice: "shimmer", instructions: "Voix calme, douce, posée." };
  }

  return { voice: "alloy", instructions: "Voix naturelle, claire, agréable." };
}

/* =========================
   FFmpeg helpers
========================= */
function ffmpegBaseArgs() {
  return ["-hide_banner", "-loglevel", "error"];
}

async function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    log(id, "FFMPEG START", label);

    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderrTail = "";

    child.stderr.on("data", (data) => {
      const next = stderrTail + data.toString();
      stderrTail = next.length > 6000 ? next.slice(-6000) : next;
    });

    child.on("close", (code) => {
      if (code === 0) {
        log(id, "FFMPEG OK", label);
        resolve();
      } else {
        log(id, "FFMPEG ERROR", `${label} code=${code}`);
        if (stderrTail) console.error(stderrTail);
        reject(
          new Error(
            `FFmpeg a échoué: ${label}${stderrTail ? ` | ${stderrTail}` : ""}`
          )
        );
      }
    });

    child.on("error", (error) => {
      log(id, "FFMPEG SPAWN ERROR", error.message);
      reject(error);
    });
  });
}

function aspectConfig(aspectRatio) {
  if (aspectRatio === "horizontal") {
    return { width: 960, height: 540 };
  }
  return { width: 540, height: 960 };
}

function scalePadFilter(aspectRatio) {
  const { width, height } = aspectConfig(aspectRatio);
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
}

function withFade(filter, transitionStyle, durationSec) {
  let vf = filter;
  if (transitionStyle === "fade" && durationSec > 0.8) {
    const fadeOutStart = Math.max(0, durationSec - 0.2);
    vf += `,fade=t=in:st=0:d=0.15,fade=t=out:st=${fadeOutStart}:d=0.15`;
  }
  return vf;
}

function buildStableImageFilter(aspectRatio, transitionStyle, durationSec) {
  return withFade(`${scalePadFilter(aspectRatio)},fps=25`, transitionStyle, durationSec);
}

function buildStableVideoFilter(aspectRatio, transitionStyle, durationSec) {
  return withFade(`${scalePadFilter(aspectRatio)},fps=25`, transitionStyle, durationSec);
}

async function trimAudio(inputPath, outputPath, startSec, endSec, id) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-ss",
    String(startSec),
    "-to",
    String(endSec),
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "aac",
    outputPath
  ];

  await runFfmpeg(args, id, "trim audio");
}

async function createImageSegmentStable(
  inputPath,
  outputPath,
  durationSec,
  aspectRatio,
  transitionStyle,
  id,
  label
) {
  const frameCount = Math.max(1, Math.round(durationSec * 25));

  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-loop",
    "1",
    "-framerate",
    "25",
    "-i",
    inputPath,
    "-t",
    String(durationSec),
    "-vf",
    buildStableImageFilter(aspectRatio, transitionStyle, durationSec),
    "-frames:v",
    String(frameCount),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function createVideoSegmentStable(
  inputPath,
  outputPath,
  durationSec,
  aspectRatio,
  transitionStyle,
  id,
  label
) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-t",
    String(durationSec),
    "-vf",
    buildStableVideoFilter(aspectRatio, transitionStyle, durationSec),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function concatSegmentsReencode(filePaths, outputPath, workDir, id, label, exactDurationSec) {
  const listPath = path.join(workDir, `${label.replace(/\s+/g, "_")}.txt`);

  const content = filePaths
    .map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`)
    .join("\n");

  await fsp.writeFile(listPath, content, "utf8");

  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-fflags",
    "+genpts",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-t",
    String(exactDurationSec),
    "-an",
    "-r",
    "25",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function normalizeSingleSegment(inputPath, outputPath, exactDurationSec, id, label) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-i",
    inputPath,
    "-t",
    String(exactDurationSec),
    "-an",
    "-r",
    "25",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function muxAudioAndVideo(videoPath, audioPath, outputPath, exactDurationSec, id) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-t",
    String(exactDurationSec),
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args, id, "mux final");
}

function buildFallbackTimeline(mediaManifest, totalDuration, transitionStyle, effectStyle) {
  if (!Array.isArray(mediaManifest) || !mediaManifest.length) return [];

  const timeline = [];
  const segmentDuration = totalDuration / mediaManifest.length;
  let cursor = 0;

  mediaManifest.forEach((item, index) => {
    const start = Number(cursor.toFixed(3));
    const end =
      index === mediaManifest.length - 1
        ? Number(totalDuration.toFixed(3))
        : Number((cursor + segmentDuration).toFixed(3));

    timeline.push({
      mediaId: item.id,
      start,
      end,
      transition: transitionStyle,
      effect: effectStyle
    });

    cursor = end;
  });

  return timeline;
}

function normalizeTimeline(
  timeline,
  totalDuration,
  mediaManifest,
  transitionStyle,
  effectStyle
) {
  if (!Array.isArray(timeline) || !timeline.length) {
    return buildFallbackTimeline(
      mediaManifest,
      totalDuration,
      transitionStyle,
      effectStyle
    );
  }

  const valid = timeline
    .filter((item) => item && item.mediaId)
    .map((item) => ({
      mediaId: item.mediaId,
      start: safeNumber(item.start, 0),
      end: safeNumber(item.end, 0),
      transition: safeText(item.transition) || transitionStyle,
      effect: safeText(item.effect) || effectStyle
    }))
    .filter((item) => item.end > item.start);

  if (!valid.length) {
    return buildFallbackTimeline(
      mediaManifest,
      totalDuration,
      transitionStyle,
      effectStyle
    );
  }

  const total = valid.reduce((sum, item) => sum + (item.end - item.start), 0);

  if (Math.abs(total - totalDuration) < 0.2) {
    return valid;
  }

  let cursor = 0;
  return valid.map((item, index) => {
    const originalDur = item.end - item.start;
    const ratio = originalDur / total;

    const duration =
      index === valid.length - 1
        ? Number((totalDuration - cursor).toFixed(3))
        : Number((totalDuration * ratio).toFixed(3));

    const normalized = {
      ...item,
      start: Number(cursor.toFixed(3)),
      end: Number((cursor + duration).toFixed(3))
    };

    cursor = normalized.end;
    return normalized;
  });
}

/* =========================
   Root / Health
========================= */
app.get("/", (_req, res) => {
  res.status(200).send("Backend montage IA OK");
});

app.head("/", (_req, res) => {
  res.status(200).end();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Backend principal opérationnel",
    textModelDisabled: true,
    textModelName: OPENAI_MODEL,
    ttsModel: TTS_MODEL,
    ffmpeg: !!ffmpegPath,
    openaiVoiceEnabled: !!client,
    geminiServerConfigured: isGeminiConfigured(),
    geminiServerUrl: GEMINI_SERVER_URL || "",
    geminiAnalysisEnabled: ENABLE_GEMINI_ANALYSIS,
    geminiClipIdeasEnabled: ENABLE_GEMINI_CLIP_IDEAS,
    geminiSelectMediaEnabled: ENABLE_GEMINI_SELECT_MEDIA,
    cacheEnabled: ENABLE_PROJECT_CACHE,
    cacheSize: projectCache.size
  });
});

/* =========================
   Local meta
========================= */
app.post("/api/meta/generate", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const style = safeText(req.body?.style) || "créatif";
    const projectType = safeText(req.body?.projectType) || "media";
    const tone = safeText(req.body?.tone) || "normal";
    const voiceStyle = safeText(req.body?.voiceStyle) || "";
    const mode = safeText(req.body?.mode) || "video";
    const analysis = parseObjectSafe(req.body?.analysis, null);
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, null);

    log(id, "META LOCAL", `${title} / ${projectType}`);

    const meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    res.json({
      ok: true,
      source: "local",
      general: meta.general,
      shorts: meta.shorts
    });
  } catch (error) {
    console.error(`[${id}] META LOCAL ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les métadonnées."
    });
  }
});

/* =========================
   Local subtitles
========================= */
app.post("/api/subtitles/from-text", async (req, res) => {
  const id = req.reqId;

  try {
    const lyricsText = safeText(req.body?.lyricsText || "");
    const lyricsApprox = parseArraySafe(req.body?.lyricsApprox, []);
    const startSec = safeNumber(req.body?.startSec, 0);
    const endSec = safeNumber(req.body?.endSec, 30);

    const subtitles = buildSubtitlePayload({
      lyricsText,
      lyricsApprox,
      startSec,
      endSec
    });

    log(
      id,
      "SUBTITLES LOCAL",
      subtitles.enabled ? `${subtitles.segments.length} segments` : "aucun texte"
    );

    res.json({
      ok: true,
      source: subtitles.enabled ? "local" : "none",
      subtitles
    });
  } catch (error) {
    console.error(`[${id}] SUBTITLES LOCAL ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les sous-titres."
    });
  }
});

/* =========================
   Orchestration complète avec audio
========================= */
app.post("/api/project/prepare", upload.single("audio"), async (req, res) => {
  const id = req.reqId;
  const audioFile = req.file;

  try {
    if (!audioFile) {
      return res.status(400).json({
        ok: false,
        error: "Audio manquant."
      });
    }

    const title = safeText(req.body?.title) || "Projet musique";
    const context = safeText(req.body?.context) || "";
    const projectType = safeText(req.body?.projectType) || "music";
    const style = safeText(req.body?.style) || "social";
    const tone = safeText(req.body?.tone) || "normal";
    const voiceStyle = safeText(req.body?.voiceStyle) || "";
    const mode = safeText(req.body?.mode) || "video";
    const aspectRatio = safeText(req.body?.aspectRatio) || "vertical";
    const mediaSourceMode = safeText(req.body?.mediaSourceMode) || "single";
    const allowedBlocks = parseArraySafe(req.body?.allowedBlocks || req.body?.allowedBlocksJson, []);
    const candidates = parseArraySafe(
      req.body?.candidates || req.body?.candidatesJson || req.body?.mediaManifestJson,
      []
    );

    const includeClipIdeas = parseBooleanish(req.body?.includeClipIdeas, true);
    const forceGeminiSelection = parseBooleanish(req.body?.forceGeminiSelection, true);

    const audioStartSec = safeNumber(req.body?.audioStartSec, 0);
    const audioEndSec = safeNumber(req.body?.audioEndSec, 0);
    const targetDurationSec = safeNumber(
      req.body?.targetDurationSec,
      audioEndSec > audioStartSec ? audioEndSec - audioStartSec : 30
    );
    const durationSec =
      targetDurationSec > 0
        ? targetDurationSec
        : audioEndSec > audioStartSec
        ? audioEndSec - audioStartSec
        : 30;

    const manualLyricsText = safeText(req.body?.lyricsText || "");

    log(id, "PROJECT PREP START", `${title} / candidates=${candidates.length}`);

    let analysis = {};
    let clipIdeas = {};
    let analysisSource = "none";
    let clipIdeasSource = "none";
    let analysisError = "";
    let clipIdeasError = "";

    try {
      const analyzed = await callGeminiAnalyzeAudio({
        audioPath: audioFile.path,
        audioName: audioFile.originalname || "audio.bin",
        audioMimeType: audioFile.mimetype || "audio/mpeg",
        title,
        context,
        id
      });

      analysis = analyzed?.analysis || {};
      analysisSource = analyzed?.source || (analyzed?.ok ? "gemini" : "none");
    } catch (error) {
      analysisError = error?.message || "Analyse Gemini impossible.";
      log(id, "GEMINI ANALYZE FAIL -> CONTINUE", analysisError);
    }

    if (includeClipIdeas && analysis && Object.keys(analysis).length) {
      try {
        const clipResult = await callGeminiClipIdeas({
          title,
          context,
          analysis,
          id
        });

        clipIdeas = clipResult?.result || {};
        clipIdeasSource = clipResult?.source || (clipResult?.ok ? "gemini" : "none");
      } catch (error) {
        clipIdeasError = error?.message || "Clip ideas Gemini impossible.";
        log(id, "GEMINI CLIP IDEAS FAIL -> CONTINUE", clipIdeasError);
      }
    }

    let selectedCandidates = candidates;
    let selectedIds = [];
    let selectionReasoning = "";
    let mediaSelectionSource = "local_fallback";
    let mediaSelectionError = "";

    if (
      candidates.length &&
      shouldUseGeminiSelection({
        candidates,
        forceGeminiSelection
      }) &&
      analysis &&
      Object.keys(analysis).length
    ) {
      try {
        const selected = await callGeminiSelectMedia({
          title,
          targetDurationSec: durationSec,
          aspectRatio,
          mediaSourceMode,
          allowedBlocks,
          analysis,
          clipIdeas,
          candidates,
          id
        });

        selectedIds = Array.isArray(selected?.selectedIds) ? selected.selectedIds : [];
        selectionReasoning = safeText(selected?.reasoning || "");
        mediaSelectionSource = selected?.source || "gemini";

        if (selectedIds.length) {
          selectedCandidates = chooseCandidatesByIds(candidates, selectedIds);
        } else {
          selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
          mediaSelectionSource = `${mediaSelectionSource}_empty_fallback`;
        }
      } catch (error) {
        mediaSelectionError = error?.message || "Sélection Gemini impossible.";
        selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
        mediaSelectionSource = "local_fallback";
        log(id, "GEMINI SELECT FAIL -> LOCAL", mediaSelectionError);
      }
    } else if (candidates.length) {
      selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
    }

    const plan = candidates.length
      ? buildLocalMontagePlan({
          candidates: selectedCandidates,
          durationSec: durationSec,
          transitionStyle: "fade",
          effectStyle:
            selectedCandidates.length &&
            selectedCandidates.every((item) => safeText(item.mediaType) === "image")
              ? "zoom"
              : "clean"
        })
      : null;

    const meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone: safeText(analysis?.dominantMood) || tone || style,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    const subtitles = buildSubtitlePayload({
      lyricsText: manualLyricsText,
      lyricsApprox: analysis?.lyricsApprox || analysis?.lyrics || [],
      startSec: audioStartSec,
      endSec: audioStartSec + durationSec
    });

    log(
      id,
      "PROJECT PREP OK",
      `analysis=${analysisSource} clipIdeas=${clipIdeasSource} select=${mediaSelectionSource} subtitles=${subtitles.enabled ? "local" : "none"}`
    );

    res.json({
      ok: true,
      analysis,
      clipIdeas,
      plan,
      general: meta.general,
      shorts: meta.shorts,
      subtitles,
      selectedIds: plan?.selectedMediaIds || selectedIds,
      selectionReasoning,
      source: {
        analysis: analysisSource,
        clipIdeas: clipIdeasSource,
        mediaSelection: mediaSelectionSource,
        meta: "local",
        subtitles: subtitles.enabled ? "local" : "none",
        plan: "local"
      },
      warnings: {
        analysisError,
        clipIdeasError,
        mediaSelectionError
      }
    });
  } catch (error) {
    console.error(`[${id}] PROJECT PREP ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de préparer le projet."
    });
  } finally {
    await removePathQuietly(audioFile?.path);
  }
});

/* =========================
   Plan montage
========================= */
app.post("/api/montage/plan", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const projectType = safeText(req.body?.projectType) || "music";
    const style = safeText(req.body?.style) || "social";
    const tone = safeText(req.body?.tone) || "normal";
    const mode = safeText(req.body?.mode) || "video";
    const aspectRatio = safeText(req.body?.aspectRatio) || "vertical";
    const mediaSourceMode = safeText(req.body?.mediaSourceMode) || "single";
    const allowedBlocks = parseArraySafe(req.body?.allowedBlocks, []);
    const forceGeminiSelection = parseBooleanish(req.body?.forceGeminiSelection, true);

    const durationSec = safeNumber(req.body?.durationSec, 30);
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, {});
    const lyricsText = safeText(req.body?.lyricsText || "");
    const subtitleStartSec = safeNumber(req.body?.subtitleStartSec, 0);
    const subtitleEndSec = safeNumber(req.body?.subtitleEndSec, durationSec);

    const candidates = Array.isArray(req.body?.candidates)
      ? req.body.candidates
      : parseArraySafe(req.body?.candidates, []);

    if (!candidates.length) {
      return res.status(400).json({
        ok: false,
        error: "Aucun média candidat."
      });
    }

    let selectedCandidates = candidates;
    let selectionReasoning = "";
    let selectedIds = [];
    let mediaSelectionSource = "local_fallback";
    let mediaSelectionError = "";

    if (
      shouldUseGeminiSelection({
        candidates,
        forceGeminiSelection
      }) &&
      analysis &&
      Object.keys(analysis).length
    ) {
      try {
        const selected = await callGeminiSelectMedia({
          title,
          targetDurationSec: durationSec,
          aspectRatio,
          mediaSourceMode,
          allowedBlocks,
          analysis,
          clipIdeas,
          candidates,
          id
        });

        selectedIds = Array.isArray(selected?.selectedIds) ? selected.selectedIds : [];
        selectionReasoning = safeText(selected?.reasoning || "");
        mediaSelectionSource = selected?.source || "gemini";

        if (selectedIds.length) {
          selectedCandidates = chooseCandidatesByIds(candidates, selectedIds);
        } else {
          selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
          mediaSelectionSource = `${mediaSelectionSource}_empty_fallback`;
        }
      } catch (error) {
        mediaSelectionError = error?.message || "Sélection Gemini impossible.";
        selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
        mediaSelectionSource = "local_fallback";
        log(id, "GEMINI SELECT FAIL -> PLAN LOCAL", mediaSelectionError);
      }
    } else {
      selectedCandidates = buildDiversifiedFallbackCandidates(candidates, 6);
    }

    log(
      id,
      "PLAN LOCAL",
      `${title} / ${selectedCandidates.length}/${candidates.length} médias`
    );

    const plan = buildLocalMontagePlan({
      candidates: selectedCandidates,
      durationSec,
      transitionStyle: "fade",
      effectStyle:
        selectedCandidates.length &&
        selectedCandidates.every((item) => safeText(item.mediaType) === "image")
          ? "zoom"
          : "clean"
    });

    const meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone: safeText(analysis?.dominantMood) || tone || style,
      mode,
      analysis,
      clipIdeas
    });

    const subtitles = buildSubtitlePayload({
      lyricsText,
      lyricsApprox: analysis?.lyricsApprox || analysis?.lyrics || [],
      startSec: subtitleStartSec,
      endSec: subtitleEndSec
    });

    res.json({
      ok: true,
      plan,
      general: meta.general,
      shorts: meta.shorts,
      subtitles,
      selectionReasoning,
      source: {
        mediaSelection: mediaSelectionSource,
        meta: "local",
        subtitles: subtitles.enabled ? "local" : "none",
        plan: "local"
      },
      warnings: {
        mediaSelectionError
      }
    });
  } catch (error) {
    console.error(`[${id}] PLAN ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de créer le plan de montage."
    });
  }
});

/* =========================
   Sora prompts local
========================= */
app.post("/api/sora/prompts", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet vidéo";
    const start = safeNumber(req.body?.start, 0);
    const end = safeNumber(req.body?.end, 0);
    const segmentDuration = Math.max(1, safeNumber(req.body?.segmentDuration, 10));
    const style = safeText(req.body?.style) || "realisme";
    const universe = safeText(req.body?.universe || "");
    const notes = safeText(req.body?.notes || "");
    const lyricsExcerpt = safeText(req.body?.lyricsExcerpt || "");
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, {});

    const total = Math.max(0, end - start);
    if (!total || total <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Durée invalide."
      });
    }

    const prompts = buildLocalSoraPrompts({
      title,
      start,
      end,
      segmentDuration,
      style,
      universe,
      notes,
      lyricsExcerpt,
      analysis,
      clipIdeas
    });

    log(id, "SORA LOCAL", `${title} / ${prompts.length}`);

    res.json({
      ok: true,
      source: "local",
      prompts
    });
  } catch (error) {
    console.error(`[${id}] SORA LOCAL ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les prompts vidéo."
    });
  }
});

/* =========================
   OpenAI voice only
========================= */
app.post("/api/speech/generate", async (req, res) => {
  const id = req.reqId;

  try {
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY manquante."
      });
    }

    const text = safeText(req.body?.text);
    const voiceFamily = safeText(req.body?.voiceFamily) || "naturel";
    const voiceStyle = safeText(req.body?.voiceStyle) || "masculin-naturel";
    const tone = safeText(req.body?.tone) || "normal";

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Texte manquant."
      });
    }

    const voiceConfig = pickVoice(voiceFamily, voiceStyle, tone);
    log(id, "SPEECH START", `${voiceConfig.voice} / ${voiceStyle}`);

    const response = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: voiceConfig.voice,
      input: text,
      instructions: voiceConfig.instructions
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (error) {
    console.error(`[${id}] SPEECH ERROR`, error);

    const message =
      error?.code === "insufficient_quota"
        ? "Quota OpenAI dépassé pour la voix."
        : "Impossible de générer la voix.";

    res.status(500).json({
      ok: false,
      error: message
    });
  }
});

/* =========================
   Stable render video
========================= */
app.post(
  "/api/render/video",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "media", maxCount: 80 }
  ]),
  async (req, res) => {
    const id = req.reqId;
    const workDir = path.join(TMP_ROOT, `render_${Date.now()}_${id}`);
    const uploadedPaths = [
      ...(req.files?.audio || []).map((f) => f.path),
      ...(req.files?.media || []).map((f) => f.path)
    ];

    try {
      await ensureDir(workDir);

      const audioFile = req.files?.audio?.[0] || null;
      const mediaFiles = req.files?.media || [];

      if (!audioFile) {
        return res.status(400).json({
          ok: false,
          error: "Audio principal manquant."
        });
      }

      if (!mediaFiles.length) {
        return res.status(400).json({
          ok: false,
          error: "Aucun média reçu."
        });
      }

      const title = safeText(req.body?.title) || "render";
      const mode = safeText(req.body?.mode) || "image";
      const aspectRatio = safeText(req.body?.aspectRatio) || "vertical";
      const transitionStyle = safeText(req.body?.transitionStyle) || "fade";
      const effectStyle = safeText(req.body?.effectStyle) || "clean";
      const audioStartSec = safeNumber(req.body?.audioStartSec, 0);
      const audioEndSec = safeNumber(req.body?.audioEndSec, 0);
      const requestedDuration = safeNumber(req.body?.targetDurationSec, 0);

      const mediaManifest = parseArraySafe(req.body?.mediaManifestJson, []);
      const providedTimeline = parseArraySafe(req.body?.timelineJson, []);

      const selectedDuration = Math.max(0, audioEndSec - audioStartSec);
      const finalDuration =
        requestedDuration > 0
          ? Math.min(requestedDuration, selectedDuration || requestedDuration)
          : selectedDuration;

      if (!finalDuration || finalDuration <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Durée finale invalide."
        });
      }

      log(
        id,
        "RENDER START",
        `${title} / ${mode} / ${aspectRatio} / ${finalDuration}s / media=${mediaFiles.length}`
      );

      if (!ffmpegPath) {
        throw new Error("ffmpeg-static introuvable sur le serveur.");
      }

      const trimmedAudioPath = path.join(workDir, "audio_trimmed.m4a");
      const finalSilentPath = path.join(workDir, "video_silent.mp4");
      const finalPath = path.join(workDir, "final.mp4");

      await trimAudio(
        audioFile.path,
        trimmedAudioPath,
        audioStartSec,
        audioEndSec,
        id
      );

      const manifestForTimeline = mediaManifest.length
        ? mediaManifest
        : mediaFiles.map((file, index) => ({
            id: `media_${index + 1}`,
            fileName: file.originalname,
            mediaType: mode
          }));

      const fileMap = new Map();

      mediaFiles.forEach((file, index) => {
        const manifest = manifestForTimeline[index];
        const mediaId = manifest?.id || `media_${index + 1}`;
        fileMap.set(mediaId, {
          path: file.path,
          originalname: file.originalname,
          mediaType: manifest?.mediaType || mode
        });
      });

      const timeline = normalizeTimeline(
        providedTimeline,
        finalDuration,
        manifestForTimeline,
        transitionStyle,
        effectStyle
      );

      if (!timeline.length) {
        throw new Error("Timeline vide.");
      }

      log(id, "TIMELINE COUNT", `${timeline.length} segments`);
      timeline.forEach((item, index) => {
        log(
          id,
          "TIMELINE ITEM",
          `${index + 1}/${timeline.length} media=${item.mediaId} start=${item.start} end=${item.end}`
        );
      });

      const segmentFiles = [];

      for (let i = 0; i < timeline.length; i += 1) {
        const item = timeline[i];
        const media = fileMap.get(item.mediaId);

        if (!media) {
          log(id, "MEDIA MISSING", `timeline mediaId=${item.mediaId}`);
          continue;
        }

        const segmentDuration = Number((item.end - item.start).toFixed(3));
        if (segmentDuration <= 0) continue;

        const segmentPath = path.join(
          workDir,
          `segment_${String(i + 1).padStart(2, "0")}.mp4`
        );

        segmentFiles.push(segmentPath);

        log(
          id,
          "SEGMENT BUILD",
          `segment=${i + 1}/${timeline.length} media=${media.originalname} type=${media.mediaType} dur=${segmentDuration}`
        );

        if ((media.mediaType || mode) === "video") {
          await createVideoSegmentStable(
            media.path,
            segmentPath,
            segmentDuration,
            aspectRatio,
            item.transition || transitionStyle,
            id,
            `video segment ${i + 1}`
          );
        } else {
          await createImageSegmentStable(
            media.path,
            segmentPath,
            segmentDuration,
            aspectRatio,
            item.transition || transitionStyle,
            id,
            `image segment ${i + 1}`
          );
        }
      }

      if (!segmentFiles.length) {
        throw new Error("Aucun segment vidéo généré.");
      }

      if (segmentFiles.length === 1) {
        await normalizeSingleSegment(
          segmentFiles[0],
          finalSilentPath,
          finalDuration,
          id,
          "normalize silent video"
        );
      } else {
        await concatSegmentsReencode(
          segmentFiles,
          finalSilentPath,
          workDir,
          id,
          "concat final silent",
          finalDuration
        );
      }

      await muxAudioAndVideo(
        finalSilentPath,
        trimmedAudioPath,
        finalPath,
        finalDuration,
        id
      );

      const stat = await fsp.stat(finalPath);
      log(id, "RENDER OK", `${stat.size} bytes`);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${title.replace(/[^\w-]/g, "_")}.mp4"`
      );

      const stream = fs.createReadStream(finalPath);

      stream.on("close", async () => {
        await removeManyQuietly(uploadedPaths);
        await removePathQuietly(workDir);
      });

      stream.on("error", async (streamError) => {
        console.error(`[${id}] STREAM ERROR`, streamError);
        await removeManyQuietly(uploadedPaths);
        await removePathQuietly(workDir);
      });

      stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] RENDER ERROR`, error);

      await removeManyQuietly(uploadedPaths);
      await removePathQuietly(workDir);

      res.status(500).json({
        ok: false,
        error: error.message || "Impossible de créer la vidéo."
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Serveur principal démarré sur le port ${PORT}`);
});
