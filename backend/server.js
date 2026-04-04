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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
const ENABLE_GEMINI_ANALYSIS = envBool(process.env.ENABLE_GEMINI_ANALYSIS, true);
const ENABLE_GEMINI_CLIP_IDEAS = envBool(process.env.ENABLE_GEMINI_CLIP_IDEAS, true);
const ENABLE_GEMINI_SELECT_MEDIA = envBool(process.env.ENABLE_GEMINI_SELECT_MEDIA, true);
const ENABLE_PROJECT_CACHE = envBool(process.env.ENABLE_PROJECT_CACHE, true);

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const MAX_RENDER_MEDIA = Number(process.env.MAX_RENDER_MEDIA || 6);

const GEMINI_PREVIEW_MAX_SEC = Number(process.env.GEMINI_PREVIEW_MAX_SEC || 30);
const GEMINI_PREVIEW_AUDIO_BITRATE = safeBitrate(
  process.env.GEMINI_PREVIEW_AUDIO_BITRATE || "48k"
);

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-mobile");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 220 * 1024 * 1024,
    files: 30
  }
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* =========================
   Utils
========================= */
function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "non", "off"].includes(normalized)) return false;
  return fallback;
}

function safeBitrate(value) {
  const v = String(value || "").trim().toLowerCase();
  return /^\d+k$/.test(v) ? v : "48k";
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

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function shuffleArray(array = []) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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

function parseGeminiJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const fencedJson = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]) {
    try {
      return JSON.parse(fencedJson[1]);
    } catch {}
  }

  const fenced = text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const clean = safeText(value);
    if (clean) return clean;
  }
  return "";
}

function uniqueTags(tags = []) {
  const seen = new Set();
  const out = [];

  for (const tag of tags) {
    let clean = safeText(tag);
    if (!clean) continue;
    if (!clean.startsWith("#")) clean = `#${clean}`;
    clean = `#${slugTag(clean)}`;
    if (clean === "#") continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }

  return out;
}

function compactSentence(text, max = 180) {
  const clean = safeText(text).replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function isGenericProjectTitle(title) {
  const clean = safeText(title).toLowerCase();
  return !clean || ["projet", "projet musique", "music", "clip", "test"].includes(clean);
}

function buildBetterTitle({ title, analysis, clipIdeas, style, projectType }) {
  if (!isGenericProjectTitle(title)) return safeText(title);

  const mood = safeText(analysis?.dominantMood || style || "");
  const visual = safeText(clipIdeas?.visualStyle || analysis?.visualUniverse || "");

  if (projectType === "speech") {
    if (mood) return `Voix ${mood}`;
    return "Voix IA percutante";
  }

  if (visual && mood) return `Clip ${visual} ${mood}`.trim();
  if (visual) return `Clip ${visual}`;
  if (mood) return `Clip ${mood}`;
  if (style) return `Clip ${style}`;
  return "Clip musical intense";
}

function validateAnalysisObject(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    safeText(obj.summary) &&
    safeText(obj.dominantMood) &&
    safeText(obj.visualUniverse)
  );
}

function validateClipIdeasObject(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    safeText(obj.creativeDirection) &&
    safeText(obj.visualStyle) &&
    Array.isArray(obj.storyArc)
  );
}

function validateMetaObject(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    safeText(obj.general) &&
    safeText(obj.shorts)
  );
}

/* =========================
   Cache légère
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

setInterval(() => {
  const now = Date.now();
  for (const [key, item] of projectCache.entries()) {
    if (now - item.createdAt > CACHE_TTL_MS) {
      projectCache.delete(key);
    }
  }
}, 60 * 1000).unref?.();

/* =========================
   File de rendu
========================= */
const renderQueue = [];
let renderRunning = false;

function enqueueRender(task) {
  return new Promise((resolve, reject) => {
    renderQueue.push({ task, resolve, reject });
    processRenderQueue().catch((error) => {
      console.error("RENDER QUEUE ERROR", error);
    });
  });
}

async function processRenderQueue() {
  if (renderRunning) return;
  const next = renderQueue.shift();
  if (!next) return;

  renderRunning = true;

  try {
    const result = await next.task();
    next.resolve(result);
  } catch (error) {
    next.reject(error);
  } finally {
    renderRunning = false;
    if (renderQueue.length) {
      processRenderQueue().catch((error) => {
        console.error("RENDER QUEUE LOOP ERROR", error);
      });
    }
  }
}

/* =========================
   Gemini direct
========================= */
function isGeminiConfigured() {
  return !!GEMINI_API_KEY;
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

async function callGemini(parts, options = {}, id = "gemini", label = "GEMINI") {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante.");
  }

  const maxOutputTokens = Number(options.maxOutputTokens || 400);
  const temperature = Number(options.temperature ?? 0.3);
  const retryCount = Number(options.retryCount ?? 2);
  const requireJson = options.requireJson !== false;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts
              }
            ],
            generationConfig: {
              temperature,
              maxOutputTokens,
              responseMimeType: "application/json"
            }
          })
        },
        GEMINI_TIMEOUT_MS
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || `Erreur Gemini ${label}`);
      }

      const raw =
        data?.candidates?.[0]?.content?.parts
          ?.map((item) => item.text || "")
          .join("")
          .trim() || "";

      const json = parseGeminiJson(raw);

      if (requireJson && !json) {
        throw new Error(`Réponse Gemini tronquée ou JSON invalide pour ${label}`);
      }

      return { raw, json };
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        log(
          id,
          `${label} RETRY`,
          `tentative=${attempt + 1} erreur=${error.message || "unknown"}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error(`Erreur Gemini ${label}`);
}

async function geminiAnalyzeAudio({
  audioPath,
  audioMimeType = "audio/mpeg",
  title = "Projet musique",
  context = "",
  id = "gemini"
}) {
  const buffer = await fsp.readFile(audioPath);
  const audioHash = sha1(buffer);

  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-analyze-audio",
      title,
      context,
      audioHash,
      model: GEMINI_MODEL
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI ANALYZE CACHE HIT", title);
    return cached;
  }

  log(id, "GEMINI ANALYZE START", title);

  const prompt = `
Analyse cet extrait audio pour préparer un clip musical.

Réponds en JSON valide uniquement.
Français uniquement.
Pas de markdown.
Réponse courte et exploitable.
Maximum 3 éléments par tableau.
Ne jamais inventer des paroles si elles ne sont pas audibles.

Format exact :
{
  "summary": "",
  "dominantMood": "",
  "energyLevel": "",
  "rhythmEstimate": "",
  "visualUniverse": "",
  "emotions": [],
  "hookMoments": [],
  "sceneIdeas": [],
  "editingAdvice": [],
  "soraDirection": "",
  "lyricsApprox": []
}

Contexte :
${context}

Titre :
${title}
`.trim();

  const result = await callGemini(
    [
      { text: prompt },
      {
        inlineData: {
          mimeType: audioMimeType,
          data: buffer.toString("base64")
        }
      }
    ],
    {
      maxOutputTokens: 520,
      temperature: 0.25,
      retryCount: 3,
      requireJson: true
    },
    id,
    "GEMINI ANALYZE"
  );

  const candidate = result.json || null;
  if (!validateAnalysisObject(candidate)) {
    throw new Error("Analyse Gemini incomplète ou invalide.");
  }

  const analysis = {
    summary: compactSentence(candidate.summary, 180),
    dominantMood: compactSentence(candidate.dominantMood, 40),
    energyLevel: compactSentence(candidate.energyLevel, 30),
    rhythmEstimate: compactSentence(candidate.rhythmEstimate, 50),
    visualUniverse: compactSentence(candidate.visualUniverse, 60),
    emotions: Array.isArray(candidate.emotions)
      ? candidate.emotions.map((v) => compactSentence(v, 30)).filter(Boolean).slice(0, 3)
      : [],
    hookMoments: Array.isArray(candidate.hookMoments)
      ? candidate.hookMoments.map((v) => compactSentence(v, 60)).filter(Boolean).slice(0, 3)
      : [],
    sceneIdeas: Array.isArray(candidate.sceneIdeas)
      ? candidate.sceneIdeas.map((v) => compactSentence(v, 70)).filter(Boolean).slice(0, 3)
      : [],
    editingAdvice: Array.isArray(candidate.editingAdvice)
      ? candidate.editingAdvice.map((v) => compactSentence(v, 70)).filter(Boolean).slice(0, 3)
      : [],
    soraDirection: compactSentence(candidate.soraDirection, 120),
    lyricsApprox: Array.isArray(candidate.lyricsApprox)
      ? candidate.lyricsApprox.map((v) => compactSentence(v, 80)).filter(Boolean).slice(0, 3)
      : []
  };

  setCache(cacheKey, analysis);
  log(id, "GEMINI ANALYZE OK", title);
  return analysis;
}

async function geminiClipIdeas({
  title = "Projet musique",
  context = "",
  analysis = {},
  id = "gemini"
}) {
  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-clip-ideas",
      title,
      context,
      analysis,
      model: GEMINI_MODEL
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI CLIP IDEAS CACHE HIT", title);
    return cached;
  }

  log(id, "GEMINI CLIP IDEAS START", title);

  const prompt = `
Crée une idée de clip courte et concrète à partir de cette analyse.

Réponds en JSON valide uniquement.
Français uniquement.
Pas de markdown.
Réponse courte.
Maximum 4 étapes dans storyArc.
Maximum 3 idées rapides.

Format exact :
{
  "creativeDirection": "",
  "visualStyle": "",
  "cameraStyle": "",
  "colorPalette": "",
  "storyArc": [],
  "shortPromptIdeas": []
}

Contexte :
${context}

Analyse :
${JSON.stringify(analysis)}
`.trim();

  const result = await callGemini(
    [{ text: prompt }],
    {
      maxOutputTokens: 380,
      temperature: 0.35,
      retryCount: 3,
      requireJson: true
    },
    id,
    "GEMINI CLIP IDEAS"
  );

  const candidate = result.json || null;
  if (!validateClipIdeasObject(candidate)) {
    throw new Error("Idée de clip Gemini incomplète ou invalide.");
  }

  const payload = {
    creativeDirection: compactSentence(candidate.creativeDirection, 180),
    visualStyle: compactSentence(candidate.visualStyle, 60),
    cameraStyle: compactSentence(candidate.cameraStyle, 60),
    colorPalette: compactSentence(candidate.colorPalette, 60),
    storyArc: Array.isArray(candidate.storyArc)
      ? candidate.storyArc.map((v) => compactSentence(v, 70)).filter(Boolean).slice(0, 4)
      : [],
    shortPromptIdeas: Array.isArray(candidate.shortPromptIdeas)
      ? candidate.shortPromptIdeas.map((v) => compactSentence(v, 70)).filter(Boolean).slice(0, 3)
      : []
  };

  setCache(cacheKey, payload);
  log(id, "GEMINI CLIP IDEAS OK", title);
  return payload;
}

function normalizeAllowedBlocks(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean);
}

function normalizeCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && item.id)
    .map((item, index) => ({
      id: String(item.id),
      order: safeNumber(item.order, index + 1),
      mediaType: safeText(item.mediaType || item.type || "video") || "video",
      ratio: safeText(
        item.ratio || item.aspectRatio || item.orientation || "unknown"
      ).toLowerCase(),
      block: safeText(item.block || item.collection || item.category || item.group || "vrac"),
      durationSec: safeNumber(item.durationSec || item.duration || 0, 0),
      label: safeText(item.label || item.name || item.fileName || `media_${index + 1}`),
      tags: Array.isArray(item.tags) ? item.tags : []
    }));
}

function ratioCompatible(aspectRatio, candidateRatio) {
  const target = safeText(aspectRatio).toLowerCase();
  const ratio = safeText(candidateRatio).toLowerCase();

  if (!target || !ratio) return true;
  if (target === "vertical") return ["vertical", "square", "unknown"].includes(ratio);
  if (target === "horizontal") return ["horizontal", "square", "unknown"].includes(ratio);
  return true;
}

function normalizeSelectedIds(rawIds, candidates) {
  const validIds = new Set(candidates.map((item) => String(item.id)));
  const out = [];
  const seen = new Set();

  for (const value of Array.isArray(rawIds) ? rawIds : []) {
    const id = String(value);
    if (!validIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

function diversifiedFallbackSelectedIds(candidates, aspectRatio, allowedBlocks) {
  const targetCount = Math.min(6, Math.max(3, candidates.length));
  const result = [];
  const usedIds = new Set();
  const usedBlocks = new Set();

  const filtered = candidates.filter((item) => {
    const blockOk =
      !allowedBlocks.length || allowedBlocks.includes(safeText(item.block).toLowerCase());
    const ratioOk = ratioCompatible(aspectRatio, item.ratio);
    return blockOk && ratioOk;
  });

  const source = filtered.length ? filtered : candidates;

  for (const item of source) {
    const id = String(item.id);
    const block = safeText(item.block).toLowerCase();

    if (usedIds.has(id)) continue;
    if (usedBlocks.has(block) && usedBlocks.size < targetCount) continue;

    result.push(id);
    usedIds.add(id);
    usedBlocks.add(block);

    if (result.length >= targetCount) return result;
  }

  for (const item of source) {
    const id = String(item.id);
    if (usedIds.has(id)) continue;
    result.push(id);
    usedIds.add(id);
    if (result.length >= targetCount) return result;
  }

  return result;
}

async function geminiSelectMedia({
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
  const compactCandidates = normalizeCandidates(candidates);

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
      compactCandidates,
      model: GEMINI_MODEL
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI SELECT CACHE HIT", `${title} / ${compactCandidates.length}`);
    return cached;
  }

  log(id, "GEMINI SELECT START", `${title} / ${compactCandidates.length} candidats`);

  const prompt = `
Choisis les meilleurs médias pour un clip court.

Réponds en JSON valide uniquement.
Français uniquement.
Pas de markdown.
Choisis entre 3 et 6 IDs.
Privilégie la variété, le bon ratio et la cohérence.
Retourne les IDs dans l'ordre final de montage.

Format exact :
{
  "selectedIds": [],
  "reasoning": ""
}

Projet :
- titre : ${title}
- durée cible : ${targetDurationSec}
- format : ${aspectRatio}
- source médias : ${mediaSourceMode}
- blocs autorisés : ${allowedBlocks.join(", ") || "tous"}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}

Candidats :
${JSON.stringify(compactCandidates)}
`.trim();

  const result = await callGemini(
    [{ text: prompt }],
    {
      maxOutputTokens: 300,
      temperature: 0.3,
      retryCount: 3,
      requireJson: true
    },
    id,
    "GEMINI SELECT"
  );

  let selectedIds = normalizeSelectedIds(result.json?.selectedIds, compactCandidates);
  let reasoning = safeText(result.json?.reasoning || "");

  if (selectedIds.length < Math.min(3, compactCandidates.length)) {
    selectedIds = diversifiedFallbackSelectedIds(
      compactCandidates,
      aspectRatio,
      normalizeAllowedBlocks(allowedBlocks)
    );
    reasoning = reasoning
      ? `${reasoning} | Fallback diversifié appliqué.`
      : "Fallback diversifié appliqué.";
  }

  const payload = {
    selectedIds,
    reasoning: compactSentence(reasoning, 120)
  };

  setCache(cacheKey, payload);
  log(id, "GEMINI SELECT OK", `${title} / ${selectedIds.length} ids`);
  return payload;
}

function buildReadyToCopyMeta({
  title = "",
  projectType = "music",
  style = "",
  tone = "",
  voiceStyle = "",
  mode = "video",
  analysis = {},
  clipIdeas = {},
  sourceText = ""
}) {
  const finalTitle = buildBetterTitle({
    title,
    analysis,
    clipIdeas,
    style,
    projectType
  });

  const description = firstNonEmpty(
    sourceText,
    clipIdeas?.creativeDirection,
    analysis?.summary,
    projectType === "speech"
      ? `Une création vocale claire et directe, pensée pour être utilisée immédiatement sur les réseaux.`
      : `Un montage ${safeText(style || analysis?.dominantMood || "intense")} avec une ambiance forte et un rendu pensé pour accrocher dès les premières secondes.`
  );

  const baseTags = [
    projectType === "speech" ? "#voixia" : "#clipmusical",
    mode === "video" ? "#video" : "#image",
    "#montageia",
    analysis?.dominantMood ? `#${slugTag(analysis.dominantMood)}` : "",
    clipIdeas?.visualStyle ? `#${slugTag(clipIdeas.visualStyle)}` : "",
    style ? `#${slugTag(style)}` : "",
    tone ? `#${slugTag(tone)}` : "",
    voiceStyle ? `#${slugTag(voiceStyle)}` : "",
    mode === "video" ? "#shortvideo" : "#contenu"
  ];

  const hashtags = uniqueTags(baseTags).slice(0, 5);

  const general = [
    finalTitle,
    compactSentence(description, 220),
    hashtags.join(" ")
  ].join("\n");

  const shortsTags = uniqueTags([
    projectType === "speech" ? "#voixia" : "#clipmusical",
    "#montageia",
    analysis?.dominantMood ? `#${slugTag(analysis.dominantMood)}` : "",
    "#shorts"
  ]).slice(0, 3);

  let shorts = `${finalTitle}\n${shortsTags.join(" ")}`.trim();
  if (shorts.length > 100) {
    const reducedTitle = compactSentence(finalTitle, 55);
    shorts = `${reducedTitle}\n${shortsTags.join(" ")}`.trim().slice(0, 100);
  }

  return {
    general,
    shorts,
    hashtags
  };
}

async function geminiMetaGenerate({
  title = "Projet",
  projectType = "music",
  style = "créatif",
  tone = "normal",
  voiceStyle = "",
  mode = "video",
  analysis = {},
  clipIdeas = {},
  id = "gemini"
}) {
  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-meta-generate",
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas,
      model: GEMINI_MODEL
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI META CACHE HIT", title);
    return cached;
  }

  log(id, "GEMINI META START", `${title} / ${projectType}`);

  const prompt = `
Crée des métadonnées prêtes à copier-coller pour les réseaux sociaux.

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Pas de date
- Pas d'heure
- Pas de titre générique comme "Projet musique"
- Pas de hashtags en double
- Le champ "general" doit être exactement sur 3 lignes :
  1. un titre court fort
  2. une description naturelle
  3. 5 hashtags maximum
- Le champ "shorts" doit être prêt pour YouTube Shorts, maximum 100 caractères
- Réponse courte et directe

Format exact :
{
  "general": "",
  "shorts": "",
  "hashtags": []
}

Données :
- titre brut : ${title}
- type : ${projectType}
- style : ${style}
- ton : ${tone}
- voix : ${voiceStyle}
- mode : ${mode}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}
`.trim();

  const result = await callGemini(
    [{ text: prompt }],
    {
      maxOutputTokens: 280,
      temperature: 0.45,
      retryCount: 3,
      requireJson: true
    },
    id,
    "GEMINI META"
  );

  const candidate = result.json || null;
  const cleanGeneral = safeText(candidate?.general || "");
  const cleanShorts = safeText(candidate?.shorts || "");
  const cleanTags = uniqueTags(Array.isArray(candidate?.hashtags) ? candidate.hashtags : []).slice(0, 5);

  let payload = null;

  if (cleanGeneral && cleanShorts) {
    const generalLines = cleanGeneral
      .split(/\r?\n+/)
      .map((line) => safeText(line))
      .filter(Boolean);

    const titleLine = generalLines[0] || "";
    const descLine = generalLines[1] || "";
    const tagLine =
      generalLines.find((line) => line.includes("#")) ||
      cleanTags.join(" ");

    payload = {
      general: [
        buildBetterTitle({
          title: titleLine || title,
          analysis,
          clipIdeas,
          style,
          projectType
        }),
        compactSentence(descLine || clipIdeas?.creativeDirection || analysis?.summary || "", 220),
        uniqueTags(tagLine.split(/\s+/)).slice(0, 5).join(" ")
      ].join("\n"),
      shorts: cleanShorts.slice(0, 100),
      hashtags: cleanTags
    };
  }

  if (!validateMetaObject(payload)) {
    throw new Error("Méta Gemini incomplète ou invalide.");
  }

  setCache(cacheKey, payload);
  log(id, "GEMINI META OK", title);
  return payload;
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

async function geminiSubtitlesFromText({
  lyricsText = "",
  lyricsApprox = [],
  startSec = 0,
  endSec = 30,
  id = "gemini"
}) {
  const lines = normalizeLyricsLines(lyricsText).length
    ? normalizeLyricsLines(lyricsText)
    : normalizeLyricsLines(lyricsApprox);

  if (!lines.length) {
    log(id, "GEMINI SUBTITLES SKIP", "aucun texte");
    return {
      enabled: false,
      plainText: "",
      segments: [],
      srt: ""
    };
  }

  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-subtitles",
      lyricsText,
      lyricsApprox,
      startSec,
      endSec,
      model: GEMINI_MODEL
    })
  );

  const cached = getCache(cacheKey);
  if (cached) {
    log(id, "GEMINI SUBTITLES CACHE HIT");
    return cached;
  }

  log(id, "GEMINI SUBTITLES START", `${startSec}-${endSec}`);

  const prompt = `
Découpe ce texte en sous-titres.

Réponds en JSON valide uniquement.
Français uniquement.
Pas de markdown.
Segments lisibles.
N'invente pas de texte.

Format exact :
{
  "segments": [
    { "start": 0, "end": 1.5, "text": "" }
  ]
}

Début :
${startSec}

Fin :
${endSec}

Texte :
${lines.join("\n")}
`.trim();

  const result = await callGemini(
    [{ text: prompt }],
    {
      maxOutputTokens: 420,
      temperature: 0.2,
      retryCount: 2,
      requireJson: true
    },
    id,
    "GEMINI SUBTITLES"
  );

  const rawSegments = Array.isArray(result.json?.segments)
    ? result.json.segments
    : [];

  if (!rawSegments.length) {
    const fallback = buildSubtitlePayload({
      lyricsText,
      lyricsApprox,
      startSec,
      endSec
    });
    setCache(cacheKey, fallback);
    log(id, "GEMINI SUBTITLES OK", fallback.enabled ? `${fallback.segments.length} segments` : "none");
    return fallback;
  }

  const segments = rawSegments
    .map((item, index) => ({
      index: index + 1,
      start: safeNumber(item.start, 0),
      end: safeNumber(item.end, 0),
      text: safeText(item.text)
    }))
    .filter((item) => item.end > item.start && item.text);

  if (!segments.length) {
    const fallback = buildSubtitlePayload({
      lyricsText,
      lyricsApprox,
      startSec,
      endSec
    });
    setCache(cacheKey, fallback);
    log(id, "GEMINI SUBTITLES OK", fallback.enabled ? `${fallback.segments.length} segments` : "none");
    return fallback;
  }

  const srt = segments
    .map(
      (item) =>
        `${item.index}
${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}
${item.text}`
    )
    .join("\n\n");

  const payload = {
    enabled: true,
    plainText: segments.map((item) => item.text).join("\n"),
    segments,
    srt
  };

  setCache(cacheKey, payload);
  log(id, "GEMINI SUBTITLES OK", `${segments.length} segments`);
  return payload;
}

/* =========================
   Fallback local
========================= */
function buildFallbackMusicAnalysis(title, style = "social") {
  return {
    summary: `Montage ${style} avec une ambiance marquée et un rythme pensé pour capter l’attention rapidement.`,
    dominantMood:
      style === "sombre"
        ? "sombre"
        : style === "emotion"
        ? "émotion"
        : style === "cinematique"
        ? "cinématique"
        : "énergique",
    energyLevel: style === "emotion" ? "moyenne" : "haute",
    rhythmEstimate: "rythme court et dynamique",
    visualUniverse:
      style === "sombre"
        ? "univers sombre et contrasté"
        : style === "emotion"
        ? "univers sensible et humain"
        : style === "cinematique"
        ? "univers cinématographique"
        : "univers percutant pour réseaux sociaux",
    emotions:
      style === "emotion"
        ? ["émotion", "sensibilité", "profondeur"]
        : style === "sombre"
        ? ["tension", "mystère", "impact"]
        : ["énergie", "mouvement", "présence"],
    hookMoments: ["ouverture forte", "montée visuelle", "fin nette"],
    sceneIdeas: ["alternance de plans", "rythme court", "visuels lisibles"],
    editingAdvice: ["éviter les doublons", "garder du rythme", "changer de blocs"],
    soraDirection: "Clip cohérent, lisible et impactant.",
    lyricsApprox: []
  };
}

function buildFallbackClipIdeas(title, style = "social", analysis = {}) {
  return {
    creativeDirection: `Clip court avec une montée progressive et une ambiance claire dès les premières secondes.`,
    visualStyle:
      style === "sombre"
        ? "sombre contrasté"
        : style === "emotion"
        ? "émotion visuelle"
        : style === "cinematique"
        ? "cinématique réaliste"
        : "dynamique réseaux sociaux",
    cameraStyle:
      safeText(analysis?.energyLevel).toLowerCase() === "haute"
        ? "plans courts et énergiques"
        : "caméra fluide et propre",
    colorPalette:
      style === "sombre"
        ? "bleu nuit, noir, lumière froide"
        : style === "emotion"
        ? "tons doux et lumineux"
        : "couleurs franches et lisibles",
    storyArc: [
      "ouverture immédiate",
      "montée progressive",
      "fin mémorable"
    ],
    shortPromptIdeas: [
      "plan d’ouverture fort",
      "alternance visuelle",
      "clôture marquante"
    ]
  };
}

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
  return buildReadyToCopyMeta({
    title,
    projectType,
    style,
    tone,
    voiceStyle,
    mode,
    analysis: analysis || {},
    clipIdeas: clipIdeas || {},
    sourceText: clipIdeas?.creativeDirection || analysis?.summary || ""
  });
}

function buildDiversifiedFallbackCandidates(candidates = [], options = {}) {
  const {
    maxCount = MAX_RENDER_MEDIA,
    aspectRatio = "",
    allowedBlocks = []
  } = options;

  const normalizedBlocks = (Array.isArray(allowedBlocks) ? allowedBlocks : [])
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean);

  const list = shuffleArray(
    (Array.isArray(candidates) ? candidates : []).filter((item) => item && item.id)
  );

  const eligible = list.filter((item) => {
    const blockOk =
      !normalizedBlocks.length ||
      normalizedBlocks.includes(safeText(item.block || "").toLowerCase());
    const ratioOk = ratioCompatible(
      aspectRatio,
      item.ratio || item.aspectRatio || item.orientation || ""
    );
    return blockOk && ratioOk;
  });

  const source = eligible.length ? eligible : list;

  const result = [];
  const usedIds = new Set();
  const usedBlocks = new Set();

  for (const item of source) {
    const id = String(item.id);
    const block = safeText(item.block || "vrac").toLowerCase();

    if (usedIds.has(id)) continue;
    if (usedBlocks.has(block) && usedBlocks.size < Math.min(maxCount, 4)) continue;

    result.push(item);
    usedIds.add(id);
    usedBlocks.add(block);

    if (result.length >= maxCount) return result;
  }

  for (const item of source) {
    const id = String(item.id);
    if (usedIds.has(id)) continue;
    result.push(item);
    usedIds.add(id);
    if (result.length >= maxCount) return result;
  }

  return result;
}

function chooseCandidatesByIds(candidates = [], selectedIds = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ids = Array.isArray(selectedIds) ? selectedIds.map(String) : [];

  const ordered = ids
    .map((id) => list.find((item) => String(item?.id) === id))
    .filter(Boolean);

  return ordered.length ? ordered : list;
}

function buildLocalMontagePlan({
  candidates = [],
  durationSec = 30,
  transitionStyle = "fade",
  effectStyle = "clean"
}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && item.id)
    .slice(0, MAX_RENDER_MEDIA);

  if (!list.length) {
    return {
      transitionStyle,
      effectStyle,
      selectedMediaIds: [],
      timeline: []
    };
  }

  const totalDuration = Math.max(1, Number(durationSec || 30));
  const durations = [];

  if (list.length === 1) {
    durations.push(totalDuration);
  } else {
    const base = totalDuration / list.length;
    for (let i = 0; i < list.length; i += 1) {
      const delta = i % 2 === 0 ? 0.18 : -0.12;
      durations.push(Math.max(1.2, base + delta));
    }

    const sum = durations.reduce((a, b) => a + b, 0);
    const ratio = totalDuration / sum;
    for (let i = 0; i < durations.length; i += 1) {
      durations[i] = Number((durations[i] * ratio).toFixed(3));
    }
  }

  let cursor = 0;
  const timeline = list.map((item, index) => {
    const start = Number(cursor.toFixed(3));
    const end =
      index === list.length - 1
        ? Number(totalDuration.toFixed(3))
        : Number((cursor + durations[index]).toFixed(3));

    cursor = end;

    return {
      mediaId: String(item.id),
      start,
      end,
      transition: transitionStyle,
      effect:
        safeText(item.mediaType || item.type) === "image"
          ? "zoom"
          : effectStyle
    };
  });

  return {
    transitionStyle,
    effectStyle,
    selectedMediaIds: list.map((item) => String(item.id)),
    timeline
  };
}

function ensureMusicPlanUsable(plan, selectedCandidates, fallbackOptions = {}) {
  const fallback = buildLocalMontagePlan({
    candidates: selectedCandidates,
    durationSec: fallbackOptions.durationSec || 30,
    transitionStyle: fallbackOptions.transitionStyle || "fade",
    effectStyle: fallbackOptions.effectStyle || "clean"
  });

  if (!plan || !Array.isArray(plan.timeline) || !plan.timeline.length) {
    return fallback;
  }

  const validIds = new Set(selectedCandidates.map((item) => String(item.id)));

  const timeline = plan.timeline
    .filter((item) => item && item.mediaId && validIds.has(String(item.mediaId)))
    .map((item) => ({
      mediaId: String(item.mediaId),
      start: safeNumber(item.start, 0),
      end: safeNumber(item.end, 0),
      transition: safeText(item.transition) || fallback.transitionStyle,
      effect: safeText(item.effect) || fallback.effectStyle
    }))
    .filter((item) => item.end > item.start);

  if (!timeline.length) return fallback;

  return {
    transitionStyle: safeText(plan.transitionStyle) || fallback.transitionStyle,
    effectStyle: safeText(plan.effectStyle) || fallback.effectStyle,
    selectedMediaIds:
      Array.isArray(plan.selectedMediaIds)
        ? plan.selectedMediaIds.map(String).filter((id) => validIds.has(id))
        : fallback.selectedMediaIds,
    timeline
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
   OpenAI voice
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
      stderrTail = next.length > 8000 ? next.slice(-8000) : next;
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

async function createGeminiPreviewMp3(
  inputPath,
  outputPath,
  startSec,
  previewDurationSec,
  id
) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-ss",
    String(Math.max(0, startSec)),
    "-t",
    String(Math.max(1, previewDurationSec)),
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    GEMINI_PREVIEW_AUDIO_BITRATE,
    outputPath
  ];

  await runFfmpeg(args, id, "gemini preview mp3");
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
      mediaId: String(item.mediaId),
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

  if (Math.abs(total - totalDuration) < 0.25) {
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
   Health
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
    textModelName: OPENAI_MODEL,
    ttsModel: TTS_MODEL,
    ffmpeg: !!ffmpegPath,
    openaiVoiceEnabled: !!client,
    geminiConfigured: isGeminiConfigured(),
    geminiModel: GEMINI_MODEL,
    geminiAnalysisEnabled: ENABLE_GEMINI_ANALYSIS,
    geminiClipIdeasEnabled: ENABLE_GEMINI_CLIP_IDEAS,
    geminiSelectMediaEnabled: ENABLE_GEMINI_SELECT_MEDIA,
    cacheEnabled: ENABLE_PROJECT_CACHE,
    cacheSize: projectCache.size,
    renderQueueLength: renderQueue.length,
    renderRunning,
    geminiPreviewMaxSec: GEMINI_PREVIEW_MAX_SEC,
    geminiPreviewAudioBitrate: GEMINI_PREVIEW_AUDIO_BITRATE
  });
});

/* =========================
   Meta
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

    let meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    let source = "local";

    if (isGeminiConfigured()) {
      try {
        const geminiMeta = await geminiMetaGenerate({
          title,
          projectType,
          style,
          tone,
          voiceStyle,
          mode,
          analysis: analysis || {},
          clipIdeas: clipIdeas || {},
          id
        });

        if (validateMetaObject(geminiMeta)) {
          meta = {
            general: safeText(geminiMeta.general),
            shorts: safeText(geminiMeta.shorts)
          };
          source = "gemini";
        } else {
          source = "local_fallback";
        }
      } catch (error) {
        log(id, "GEMINI META FAIL -> LOCAL", error.message || "unknown");
        source = "local_fallback";
      }
    }

    res.json({
      ok: true,
      source,
      general: meta.general,
      shorts: meta.shorts
    });
  } catch (error) {
    console.error(`[${id}] META ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les métadonnées."
    });
  }
});

/* =========================
   Sous-titres
========================= */
app.post("/api/subtitles/from-text", async (req, res) => {
  const id = req.reqId;

  try {
    const lyricsText = safeText(req.body?.lyricsText || req.body?.text || "");
    const lyricsApprox = parseArraySafe(req.body?.lyricsApprox, []);
    const startSec = safeNumber(req.body?.startSec, 0);
    const endSec = safeNumber(req.body?.endSec, 30);

    let subtitles = buildSubtitlePayload({
      lyricsText,
      lyricsApprox,
      startSec,
      endSec
    });

    let source = subtitles.enabled ? "local" : "none";

    if (isGeminiConfigured() && (lyricsText || lyricsApprox.length)) {
      try {
        const geminiSubtitles = await geminiSubtitlesFromText({
          lyricsText,
          lyricsApprox,
          startSec,
          endSec,
          id
        });

        subtitles = geminiSubtitles;
        source = subtitles.enabled ? "gemini" : "none";
      } catch (error) {
        log(id, "GEMINI SUBTITLES FAIL -> LOCAL", error.message || "unknown");
        source = subtitles.enabled ? "local_fallback" : "none";
      }
    }

    res.json({
      ok: true,
      source,
      subtitles
    });
  } catch (error) {
    console.error(`[${id}] SUBTITLES ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les sous-titres."
    });
  }
});

/* =========================
   Préparation projet complet
========================= */
app.post("/api/project/prepare", upload.single("audio"), async (req, res) => {
  const id = req.reqId;
  const audioFile = req.file;
  let geminiPreviewPath = "";

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

    const allowedBlocks = parseArraySafe(
      req.body?.allowedBlocks || req.body?.allowedBlocksJson,
      []
    );

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
      if (!isGeminiConfigured() || !ENABLE_GEMINI_ANALYSIS) {
        throw new Error("Gemini analyse désactivé.");
      }

      geminiPreviewPath = path.join(
        TMP_ROOT,
        `gemini_preview_${Date.now()}_${id}.mp3`
      );

      await createGeminiPreviewMp3(
        audioFile.path,
        geminiPreviewPath,
        audioStartSec,
        Math.min(Math.max(1, durationSec || 30), GEMINI_PREVIEW_MAX_SEC),
        id
      );

      analysis = await geminiAnalyzeAudio({
        audioPath: geminiPreviewPath,
        audioMimeType: "audio/mpeg",
        title,
        context,
        id
      });

      analysisSource = "gemini";
    } catch (error) {
      analysisError = error?.message || "Analyse Gemini impossible.";
      analysis = buildFallbackMusicAnalysis(title, style);
      analysisSource = "local_fallback";
      log(id, "GEMINI ANALYZE FAIL -> CONTINUE", analysisError);
    } finally {
      await removePathQuietly(geminiPreviewPath);
      geminiPreviewPath = "";
    }

    if (includeClipIdeas) {
      try {
        if (!isGeminiConfigured() || !ENABLE_GEMINI_CLIP_IDEAS) {
          throw new Error("Gemini clip ideas désactivé.");
        }

        clipIdeas = await geminiClipIdeas({
          title,
          context,
          analysis,
          id
        });

        clipIdeasSource = "gemini";
      } catch (error) {
        clipIdeasError = error?.message || "Clip ideas Gemini impossible.";
        clipIdeas = buildFallbackClipIdeas(title, style, analysis);
        clipIdeasSource = "local_fallback";
        log(id, "GEMINI CLIP IDEAS FAIL -> CONTINUE", clipIdeasError);
      }
    }

    let selectedCandidates = buildDiversifiedFallbackCandidates(candidates, {
      maxCount: MAX_RENDER_MEDIA,
      aspectRatio,
      allowedBlocks
    });

    let selectionReasoning = "";
    let mediaSelectionSource = "local_fallback";
    let mediaSelectionError = "";

    if (candidates.length && forceGeminiSelection) {
      try {
        if (!isGeminiConfigured() || !ENABLE_GEMINI_SELECT_MEDIA) {
          throw new Error("Gemini sélection désactivé.");
        }

        const selected = await geminiSelectMedia({
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

        if (Array.isArray(selected?.selectedIds) && selected.selectedIds.length) {
          const geminiSelected = chooseCandidatesByIds(candidates, selected.selectedIds);
          selectedCandidates = geminiSelected.slice(0, MAX_RENDER_MEDIA);
          selectionReasoning = safeText(selected.reasoning || "");
          mediaSelectionSource = "gemini";
        } else {
          mediaSelectionSource = "local_fallback_empty";
        }
      } catch (error) {
        mediaSelectionError = error?.message || "Sélection Gemini impossible.";
        mediaSelectionSource = "local_fallback";
        log(id, "GEMINI SELECT FAIL -> LOCAL", mediaSelectionError);
      }
    }

    const effectStyle =
      selectedCandidates.length &&
      selectedCandidates.every((item) => safeText(item.mediaType || item.type) === "image")
        ? "zoom"
        : "clean";

    const plan = ensureMusicPlanUsable(
      buildLocalMontagePlan({
        candidates: selectedCandidates,
        durationSec,
        transitionStyle: "fade",
        effectStyle
      }),
      selectedCandidates,
      {
        durationSec,
        transitionStyle: "fade",
        effectStyle
      }
    );

    let meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone: safeText(analysis?.dominantMood) || tone || style,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });
    let metaSource = "local";
    let metaError = "";

    try {
      if (!isGeminiConfigured()) {
        throw new Error("Gemini meta non configuré.");
      }

      const geminiMeta = await geminiMetaGenerate({
        title,
        projectType,
        style,
        tone: safeText(analysis?.dominantMood) || tone || style,
        voiceStyle,
        mode,
        analysis,
        clipIdeas,
        id
      });

      if (validateMetaObject(geminiMeta)) {
        meta = {
          general: safeText(geminiMeta.general),
          shorts: safeText(geminiMeta.shorts)
        };
        metaSource = "gemini";
      } else {
        metaSource = "local_fallback";
      }
    } catch (error) {
      metaError = error?.message || "Méta Gemini impossible.";
      metaSource = "local_fallback";
      log(id, "GEMINI META FAIL -> LOCAL", metaError);
    }

    let subtitles = {
      enabled: false,
      plainText: "",
      segments: [],
      srt: ""
    };
    let subtitlesSource = "none";
    let subtitlesError = "";

    if (manualLyricsText || (Array.isArray(analysis?.lyricsApprox) && analysis.lyricsApprox.length)) {
      try {
        if (!isGeminiConfigured()) {
          throw new Error("Gemini sous-titres non configuré.");
        }

        subtitles = await geminiSubtitlesFromText({
          lyricsText: manualLyricsText,
          lyricsApprox: analysis?.lyricsApprox || analysis?.lyrics || [],
          startSec: audioStartSec,
          endSec: audioStartSec + durationSec,
          id
        });

        subtitlesSource = subtitles.enabled ? "gemini" : "none";
      } catch (error) {
        subtitlesError = error?.message || "Sous-titres Gemini impossibles.";
        subtitles = buildSubtitlePayload({
          lyricsText: manualLyricsText,
          lyricsApprox: analysis?.lyricsApprox || analysis?.lyrics || [],
          startSec: audioStartSec,
          endSec: audioStartSec + durationSec
        });
        subtitlesSource = subtitles.enabled ? "local_fallback" : "none";
        log(id, "GEMINI SUBTITLES FAIL -> LOCAL", subtitlesError);
      }
    } else {
      log(id, "GEMINI SUBTITLES SKIP", "aucun texte");
    }

    log(
      id,
      "PROJECT PREP OK",
      `analysis=${analysisSource} clipIdeas=${clipIdeasSource} select=${mediaSelectionSource} meta=${metaSource} subtitles=${subtitlesSource}`
    );

    res.json({
      ok: true,
      analysis,
      clipIdeas,
      plan,
      general: meta.general,
      shorts: meta.shorts,
      subtitles,
      selectedIds: plan?.selectedMediaIds || [],
      selectionReasoning,
      source: {
        analysis: analysisSource,
        clipIdeas: clipIdeasSource,
        mediaSelection: mediaSelectionSource,
        meta: metaSource,
        subtitles: subtitlesSource,
        plan: "local"
      },
      warnings: {
        analysisError,
        clipIdeasError,
        mediaSelectionError,
        metaError,
        subtitlesError
      }
    });
  } catch (error) {
    console.error(`[${id}] PROJECT PREP ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de préparer le projet."
    });
  } finally {
    await removePathQuietly(geminiPreviewPath);
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

    const candidates = parseArraySafe(req.body?.candidates, []);

    if (!candidates.length) {
      return res.status(400).json({
        ok: false,
        error: "Aucun média candidat."
      });
    }

    let selectedCandidates = buildDiversifiedFallbackCandidates(candidates, {
      maxCount: MAX_RENDER_MEDIA,
      aspectRatio,
      allowedBlocks
    });

    let selectionReasoning = "";
    let mediaSelectionSource = "local_fallback";
    let mediaSelectionError = "";

    if (forceGeminiSelection && isGeminiConfigured() && ENABLE_GEMINI_SELECT_MEDIA) {
      try {
        const selected = await geminiSelectMedia({
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

        if (Array.isArray(selected?.selectedIds) && selected.selectedIds.length) {
          selectedCandidates = chooseCandidatesByIds(candidates, selected.selectedIds).slice(
            0,
            MAX_RENDER_MEDIA
          );
          selectionReasoning = safeText(selected?.reasoning || "");
          mediaSelectionSource = "gemini";
        } else {
          mediaSelectionSource = "local_fallback_empty";
        }
      } catch (error) {
        mediaSelectionError = error?.message || "Sélection Gemini impossible.";
        mediaSelectionSource = "local_fallback";
        log(id, "GEMINI SELECT FAIL -> PLAN LOCAL", mediaSelectionError);
      }
    }

    const effectStyle =
      selectedCandidates.length &&
      selectedCandidates.every((item) => safeText(item.mediaType || item.type) === "image")
        ? "zoom"
        : "clean";

    const plan = buildLocalMontagePlan({
      candidates: selectedCandidates,
      durationSec,
      transitionStyle: "fade",
      effectStyle
    });

    let meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone: safeText(analysis?.dominantMood) || tone || style,
      mode,
      analysis,
      clipIdeas
    });

    let metaSource = "local";
    if (isGeminiConfigured()) {
      try {
        const geminiMeta = await geminiMetaGenerate({
          title,
          projectType,
          style,
          tone: safeText(analysis?.dominantMood) || tone || style,
          voiceStyle: "",
          mode,
          analysis,
          clipIdeas,
          id
        });

        if (validateMetaObject(geminiMeta)) {
          meta = {
            general: safeText(geminiMeta.general),
            shorts: safeText(geminiMeta.shorts)
          };
          metaSource = "gemini";
        } else {
          metaSource = "local_fallback";
        }
      } catch (error) {
        metaSource = "local_fallback";
        log(id, "GEMINI META FAIL -> PLAN LOCAL", error.message || "unknown");
      }
    }

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
        meta: metaSource,
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
   Sora prompts
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
   Render video
========================= */
async function handleRenderVideo(req, res) {
  const id = req.reqId;
  const workDir = path.join(TMP_ROOT, `render_${Date.now()}_${id}`);
  const uploadedPaths = [
    ...(req.files?.audio || []).map((f) => f.path),
    ...(req.files?.media || []).map((f) => f.path)
  ];

  try {
    await ensureDir(workDir);

    const audioFile = req.files?.audio?.[0] || null;
    const mediaFiles = (req.files?.media || []).slice(0, MAX_RENDER_MEDIA);

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
      ? mediaManifest.slice(0, mediaFiles.length)
      : mediaFiles.map((file, index) => ({
          id: `media_${index + 1}`,
          fileName: file.originalname,
          mediaType: mode
        }));

    const fileMap = new Map();

    mediaFiles.forEach((file, index) => {
      const manifest = manifestForTimeline[index];
      const mediaId = manifest?.id || `media_${index + 1}`;
      fileMap.set(String(mediaId), {
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
    ).filter((item) => fileMap.has(String(item.mediaId)));

    if (!timeline.length) {
      throw new Error("Timeline vide.");
    }

    const segmentFiles = [];

    for (let i = 0; i < timeline.length; i += 1) {
      const item = timeline[i];
      const media = fileMap.get(String(item.mediaId));

      if (!media) continue;

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

app.post(
  "/api/render/video",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "media", maxCount: 20 }
  ]),
  async (req, res) => {
    enqueueRender(() => handleRenderVideo(req, res)).catch((error) => {
      console.error("RENDER ENQUEUE ERROR", error);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "Erreur file de rendu."
        });
      }
    });
  }
);

app.listen(PORT, () => {
  console.log(`Serveur principal démarré sur le port ${PORT}`);
});
