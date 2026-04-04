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
const ENABLE_PROJECT_CACHE = envBool(process.env.ENABLE_PROJECT_CACHE, true);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const GEMINI_ANALYZE_RETRY_COUNT = Number(
  process.env.GEMINI_ANALYZE_RETRY_COUNT || 1
);

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

function compactSentence(text, max = 180) {
  const clean = safeText(text).replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function compactParagraph(text, max = 320) {
  const clean = safeText(text).replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function cleanupLooseText(text) {
  return safeText(text)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(text) {
  const clean = safeText(text);
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function slugTag(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
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

function firstNonEmpty(...values) {
  for (const value of values) {
    const clean = safeText(value);
    if (clean) return clean;
  }
  return "";
}

function isGenericProjectTitle(title) {
  const clean = safeText(title).toLowerCase();
  return !clean || ["projet", "projet musique", "music", "clip", "test"].includes(clean);
}

function splitLooseList(value) {
  const text = cleanupLooseText(value);
  if (!text) return [];
  return text
    .split(/\s*\|\s*|\s*;\s*|\s*,\s*|\n+/)
    .map((item) => cleanupLooseText(item))
    .filter(Boolean);
}

function normalizeKeywordList(list = [], max = 6) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const clean = cleanupLooseText(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }

  return out;
}

function normalizeSentenceList(list = [], max = 4, maxLen = 80) {
  return normalizeKeywordList(list, max)
    .map((item) => compactSentence(item, maxLen))
    .filter(Boolean)
    .slice(0, max);
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
   Gemini unique + partiel accepté
========================= */
const GEMINI_LITE_MARKERS = [
  "TRANSCRIPTION",
  "SUMMARY",
  "MOOD",
  "ENERGY",
  "VISUAL_UNIVERSE",
  "KEYWORDS"
];

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

function parseTaggedSections(rawText, markers = []) {
  const text = safeText(rawText).replace(/\r/g, "");
  if (!text) return {};

  const regex = new RegExp(`(^|\\n)(${markers.join("|")}):`, "g");
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      marker: match[2],
      index: match.index + match[1].length
    });
  }

  if (!matches.length) return {};

  const sections = {};

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index + current.marker.length + 1;
    const end = next ? next.index : text.length;
    sections[current.marker] = cleanupLooseText(text.slice(start, end));
  }

  return sections;
}

function parseGeminiLiteAnalysis(rawText) {
  const sections = parseTaggedSections(rawText, GEMINI_LITE_MARKERS);

  return {
    transcription: sections.TRANSCRIPTION || "",
    summary: sections.SUMMARY || "",
    mood: sections.MOOD || "",
    energy: sections.ENERGY || "",
    visualUniverse: sections.VISUAL_UNIVERSE || "",
    keywords: splitLooseList(sections.KEYWORDS || "")
  };
}

function countFilledLiteFields(candidate = {}) {
  let count = 0;
  if (safeText(candidate.transcription)) count += 1;
  if (safeText(candidate.summary)) count += 1;
  if (safeText(candidate.mood)) count += 1;
  if (safeText(candidate.energy)) count += 1;
  if (safeText(candidate.visualUniverse)) count += 1;
  if (Array.isArray(candidate.keywords) && candidate.keywords.length) count += 1;
  return count;
}

async function callGeminiAnalysisText(parts, options = {}, id = "gemini") {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante.");
  }

  const maxOutputTokens = Number(options.maxOutputTokens || 420);
  const temperature = Number(options.temperature ?? 0.2);
  const retryCount = Number(options.retryCount ?? GEMINI_ANALYZE_RETRY_COUNT);

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
              maxOutputTokens
            }
          })
        },
        GEMINI_TIMEOUT_MS
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "Erreur appel Gemini.");
      }

      const raw =
        data?.candidates?.[0]?.content?.parts
          ?.map((item) => item.text || "")
          .join("")
          .trim() || "";

      const parsed = parseGeminiLiteAnalysis(raw);
      const filledCount = countFilledLiteFields(parsed);

      if (filledCount === 0) {
        const preview = raw.replace(/\s+/g, " ").slice(0, 220);
        log(id, "GEMINI ANALYZE RAW", preview || "vide");
        throw new Error("Réponse Gemini vide ou inutilisable.");
      }

      if (filledCount < 3) {
        const preview = raw.replace(/\s+/g, " ").slice(0, 220);
        log(id, "GEMINI ANALYZE RAW", preview || "vide");
      }

      return { raw, parsed, filledCount };
    } catch (error) {
      lastError = error;

      if (attempt < retryCount) {
        log(
          id,
          "GEMINI ANALYZE RETRY",
          `tentative=${attempt + 1} erreur=${error.message || "unknown"}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1600 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("Erreur Gemini analyse.");
}

/* =========================
   Analyse locale + enrichissement
========================= */
function buildFallbackMusicAnalysis(title, style = "social") {
  const mood =
    style === "sombre"
      ? "sombre"
      : style === "emotion"
      ? "émotionnel"
      : style === "cinematique"
      ? "cinématique"
      : "énergique";

  const visual =
    style === "sombre"
      ? "univers sombre urbain"
      : style === "emotion"
      ? "univers sensible et humain"
      : style === "cinematique"
      ? "univers cinématographique réaliste"
      : "univers visuel percutant pour réseaux";

  const analysis = {
    transcription: "",
    summary: `Montage ${mood} avec une ambiance marquée et un rythme pensé pour capter l’attention rapidement.`,
    detailedSummary: `Le morceau dégage une atmosphère ${mood} avec une présence immédiate. Le rendu visuel conseillé est cohérent, rapide à lire et conçu pour frapper dès les premières secondes.`,
    dominantMood: mood,
    energyLevel: style === "emotion" ? "moyenne" : "haute",
    rhythmEstimate: style === "emotion" ? "rythme progressif" : "rythme court et dynamique",
    visualUniverse: visual,
    emotions:
      style === "emotion"
        ? ["émotion", "sensibilité", "profondeur"]
        : style === "sombre"
        ? ["tension", "mystère", "impact"]
        : ["énergie", "présence", "intensité"],
    themes:
      style === "cinematique"
        ? ["ascension", "présence", "impact"]
        : ["mouvement", "rythme", "visuel"],
    keywords:
      style === "cinematique"
        ? ["cinématique", "réalisme", "montée", "impact", "clip"]
        : ["clip", "énergie", "rythme", "mouvement", "impact"],
    hookMoments: ["ouverture forte", "montée progressive", "fin nette"],
    artisticDirection:
      "Clip réaliste, lisible et impactant avec un rythme visuel cohérent.",
    clipType: "performance + narration légère",
    lyricsApprox: [],
    sceneIdeas: [],
    editingAdvice: [],
    soraDirection: ""
  };

  analysis.sceneIdeas = buildSceneIdeasFromAnalysis(analysis);
  analysis.editingAdvice = buildEditingAdviceFromAnalysis(analysis);
  analysis.soraDirection = buildSoraDirectionFromAnalysis(analysis);

  return analysis;
}

function normalizeTranscriptionLines(text) {
  const clean = cleanupLooseText(text);
  if (!clean) return [];

  const fragments = clean
    .replace(/[!?]+/g, ".")
    .replace(/[,;:]+/g, ".")
    .split(/\.+/)
    .map((item) => cleanupLooseText(item))
    .filter(Boolean);

  const lines = [];
  for (const fragment of fragments) {
    const words = fragment.split(/\s+/).filter(Boolean);
    if (words.length <= 9) {
      lines.push(fragment);
      continue;
    }

    let current = [];
    for (const word of words) {
      current.push(word);
      if (current.length >= 7) {
        lines.push(current.join(" "));
        current = [];
      }
    }
    if (current.length) lines.push(current.join(" "));
  }

  return normalizeSentenceList(lines, 8, 80);
}

function deriveMoodFromText(seed = "", fallback = "énergique") {
  const text = safeText(seed).toLowerCase();

  if (/(triste|coeur|cœur|pleure|douleur|manque|seul|solitude|mélanc)/.test(text)) {
    return "émotionnel";
  }
  if (/(nuit|ombre|sombre|froid|danger|peur|noir|tension)/.test(text)) {
    return "sombre";
  }
  if (/(cinem|ciné|film|épique|ampleur|grand|destin)/.test(text)) {
    return "cinématique";
  }
  if (/(attaque|avance|force|gagne|victoire|fonce|bouge|feu)/.test(text)) {
    return "énergique";
  }

  return fallback;
}

function normalizeEnergy(value = "", fallback = "haute") {
  const text = safeText(value).toLowerCase();
  if (!text) return fallback;
  if (/(basse|low|faible|calme|lent)/.test(text)) return "basse";
  if (/(moyenne|medium|modérée|modere|progressive)/.test(text)) return "moyenne";
  if (/(haute|high|forte|élevée|elevee|intense|rapide)/.test(text)) return "haute";
  return fallback;
}

function deriveRhythmFromAnalysis(energyLevel, transcription, mood) {
  const words = normalizeTranscriptionLines(transcription)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  if (energyLevel === "haute" && words > 18) return "rapide et percutant";
  if (energyLevel === "haute") return "dynamique et régulier";
  if (energyLevel === "moyenne") return "modéré avec montée progressive";
  if (mood.includes("émotion")) return "posé et expressif";
  return "posé et atmosphérique";
}

function deriveVisualUniverse(seed = "", mood = "", fallback = "") {
  const text = `${safeText(seed)} ${safeText(mood)}`.toLowerCase();

  if (/(espace|spatial|planète|galax|cosm|orbite|cyber|robot|futur)/.test(text)) {
    return "univers futuriste et spatial";
  }
  if (/(ville|urb|rue|néon|neon|capuche|nuit)/.test(text)) {
    return "univers urbain nocturne";
  }
  if (/(sombre|ombre|noir|froid)/.test(text)) {
    return "univers sombre et contrasté";
  }
  if (/(émotion|triste|coeur|cœur|humain)/.test(text)) {
    return "univers sensible et humain";
  }
  if (/(cinem|ciné|épique|ampleur)/.test(text)) {
    return "univers cinématographique réaliste";
  }

  return fallback || "univers visuel percutant et cohérent";
}

function deriveEmotionsFromMood(mood = "", keywords = []) {
  const text = `${safeText(mood)} ${keywords.join(" ")}`.toLowerCase();

  if (/(émotion|triste|mélanc|sensible)/.test(text)) {
    return ["émotion", "sensibilité", "profondeur"];
  }
  if (/(sombre|ombre|tension|danger)/.test(text)) {
    return ["tension", "mystère", "impact"];
  }
  if (/(cinem|épique|ampleur)/.test(text)) {
    return ["ampleur", "détermination", "tension"];
  }

  return ["énergie", "présence", "intensité"];
}

function deriveThemesFromSeed(transcription = "", summary = "", keywords = []) {
  const text = `${transcription} ${summary} ${keywords.join(" ")}`.toLowerCase();
  const themes = [];

  if (/(avance|avenir|route|chemin|monte|ascension|objectif)/.test(text)) {
    themes.push("progression");
  }
  if (/(combat|guerre|force|attaque|défi|rival)/.test(text)) {
    themes.push("combat");
  }
  if (/(ville|rue|quartier|néon|nuit)/.test(text)) {
    themes.push("ville");
  }
  if (/(amour|coeur|cœur|sentiment|relation)/.test(text)) {
    themes.push("sentiments");
  }
  if (/(espace|spatial|planète|galaxie|futur)/.test(text)) {
    themes.push("science-fiction");
  }

  for (const item of keywords) {
    if (themes.length >= 5) break;
    if (safeText(item).length >= 4) themes.push(item);
  }

  if (!themes.length) {
    themes.push("présence", "impact", "mouvement");
  }

  return normalizeKeywordList(themes, 5);
}

function deriveSummaryFromPartial({ transcription, summary, mood, visualUniverse, title }) {
  if (safeText(summary)) return compactSentence(summary, 180);

  if (safeText(transcription)) {
    const lines = normalizeTranscriptionLines(transcription);
    if (lines.length) {
      return compactSentence(
        `Extrait marqué par "${lines[0]}" dans une ambiance ${mood || "forte"}.`,
        180
      );
    }
  }

  if (safeText(visualUniverse)) {
    return compactSentence(
      `Le morceau propose une ambiance ${mood || "forte"} dans un univers ${visualUniverse}.`,
      180
    );
  }

  return compactSentence(
    `${title || "Le morceau"} dégage une présence nette avec une identité visuelle exploitable.`,
    180
  );
}

function deriveDetailedSummary({
  transcription,
  summary,
  mood,
  energyLevel,
  visualUniverse,
  themes
}) {
  const parts = [
    safeText(summary),
    mood ? `L'ambiance dominante est ${mood}.` : "",
    energyLevel ? `Le niveau d'énergie est ${energyLevel}.` : "",
    visualUniverse ? `L'univers visuel conseillé est ${visualUniverse}.` : "",
    themes?.length ? `Les thèmes perçus tournent autour de ${themes.join(", ")}.` : "",
    transcription ? `Une transcription partielle exploitable a été récupérée.` : ""
  ].filter(Boolean);

  return compactParagraph(parts.join(" "), 320);
}

function buildHooksFromAnalysis(analysis = {}) {
  const hooks = [];
  const lines = Array.isArray(analysis.lyricsApprox) ? analysis.lyricsApprox : [];

  if (lines[0]) hooks.push(`entrée marquante sur "${compactSentence(lines[0], 40)}"`);
  if (lines[1]) hooks.push(`montée sur "${compactSentence(lines[1], 40)}"`);
  if (lines[lines.length - 1] && lines.length > 2) {
    hooks.push(`clôture avec "${compactSentence(lines[lines.length - 1], 40)}"`);
  }

  if (!hooks.length) {
    hooks.push("ouverture forte");
    if (safeText(analysis.energyLevel) === "haute") hooks.push("accélération visuelle au milieu");
    hooks.push("fin nette et mémorable");
  }

  return normalizeSentenceList(hooks, 4, 90);
}

function buildArtDirection(analysis = {}) {
  const parts = [
    safeText(analysis.visualUniverse) ? `univers ${analysis.visualUniverse}` : "",
    safeText(analysis.dominantMood) ? `ambiance ${analysis.dominantMood}` : "",
    safeText(analysis.energyLevel) === "haute"
      ? "caméra vive et montage rapide"
      : safeText(analysis.energyLevel) === "moyenne"
      ? "montage progressif et lisible"
      : "plans plus posés et respirations visuelles",
    analysis.themes?.length ? `thèmes : ${analysis.themes.join(", ")}` : ""
  ].filter(Boolean);

  return compactParagraph(parts.join(" | "), 220);
}

function deriveClipType(analysis = {}) {
  const mood = safeText(analysis.dominantMood).toLowerCase();

  if (mood.includes("émotion")) return "narration émotionnelle";
  if (mood.includes("cin")) return "performance cinématique";
  if (Array.isArray(analysis.lyricsApprox) && analysis.lyricsApprox.length) {
    return "performance + narration";
  }
  return "performance visuelle";
}

function buildAnalysisFromPartialCandidate(candidate = {}, title = "", style = "social") {
  const fallback = buildFallbackMusicAnalysis(title, style);

  const transcription = compactParagraph(candidate.transcription || "", 700);
  const keywords = normalizeKeywordList(candidate.keywords || [], 8);

  const mood = compactSentence(
    firstNonEmpty(candidate.mood, deriveMoodFromText(`${transcription} ${keywords.join(" ")}`, fallback.dominantMood)),
    50
  );

  const energyLevel = normalizeEnergy(candidate.energy, fallback.energyLevel);
  const visualUniverse = compactSentence(
    firstNonEmpty(
      candidate.visualUniverse,
      deriveVisualUniverse(`${transcription} ${keywords.join(" ")}`, mood, fallback.visualUniverse)
    ),
    90
  );

  const summary = deriveSummaryFromPartial({
    transcription,
    summary: candidate.summary,
    mood,
    visualUniverse,
    title
  });

  const lyricsApprox = normalizeTranscriptionLines(transcription);
  const themes = deriveThemesFromSeed(transcription, summary, keywords);
  const emotions = deriveEmotionsFromMood(mood, keywords);
  const rhythmEstimate = deriveRhythmFromAnalysis(energyLevel, transcription, mood);
  const detailedSummary = deriveDetailedSummary({
    transcription,
    summary,
    mood,
    energyLevel,
    visualUniverse,
    themes
  });

  const analysis = {
    transcription,
    summary,
    detailedSummary,
    dominantMood: mood,
    energyLevel,
    rhythmEstimate,
    visualUniverse,
    emotions,
    themes,
    keywords: keywords.length ? keywords : fallback.keywords,
    hookMoments: [],
    artisticDirection: "",
    clipType: "",
    lyricsApprox,
    sceneIdeas: [],
    editingAdvice: [],
    soraDirection: ""
  };

  analysis.hookMoments = buildHooksFromAnalysis(analysis);
  analysis.artisticDirection = buildArtDirection(analysis);
  analysis.clipType = deriveClipType(analysis);
  analysis.sceneIdeas = buildSceneIdeasFromAnalysis(analysis);
  analysis.editingAdvice = buildEditingAdviceFromAnalysis(analysis);
  analysis.soraDirection = buildSoraDirectionFromAnalysis(analysis);

  return analysis;
}

async function geminiAnalyzeAudio({
  audioPath,
  audioMimeType = "audio/mpeg",
  title = "Projet musique",
  context = "",
  style = "social",
  id = "gemini"
}) {
  const buffer = await fsp.readFile(audioPath);
  const audioHash = sha1(buffer);

  const cacheKey = sha1(
    JSON.stringify({
      kind: "gemini-single-analysis-lite",
      title,
      context,
      style,
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
Analyse cet extrait audio en français.

Réponds uniquement avec ces 6 balises exactes, dans cet ordre :
TRANSCRIPTION:
SUMMARY:
MOOD:
ENERGY:
VISUAL_UNIVERSE:
KEYWORDS:

Règles :
- pas de JSON
- pas de markdown
- pas de puces
- réponse courte et propre
- KEYWORDS : mots séparés par |
- si tu n'es pas sûr des paroles, donne une transcription approximative crédible
- SUMMARY : un seul résumé court
- ENERGY : basse ou moyenne ou haute

Contexte :
${context || "aucun"}

Titre :
${title}
`.trim();

  const result = await callGeminiAnalysisText(
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
      maxOutputTokens: 420,
      temperature: 0.2,
      retryCount: GEMINI_ANALYZE_RETRY_COUNT
    },
    id
  );

  const analysis = buildAnalysisFromPartialCandidate(result.parsed, title, style);
  const source = result.filledCount >= 5 ? "gemini" : "gemini_partial";

  const payload = {
    analysis,
    source
  };

  setCache(cacheKey, payload);
  log(id, "GEMINI ANALYZE OK", `${title} / ${source}`);
  return payload;
}

/* =========================
   Génération locale depuis analyse
========================= */
function buildSceneIdeasFromAnalysis(analysis = {}) {
  const ideas = [];
  const mood = safeText(analysis.dominantMood).toLowerCase();
  const universe = safeText(analysis.visualUniverse).toLowerCase();
  const keywords = normalizeKeywordList(analysis.keywords || [], 6);

  if (mood.includes("cin")) ideas.push("plans réalistes avec montée progressive");
  if (mood.includes("sombre") || universe.includes("nuit")) {
    ideas.push("lumières basses et contrastes marqués");
  }
  if (mood.includes("émotion")) ideas.push("gros plans sensibles et respiration visuelle");
  if (universe.includes("futur") || universe.includes("science")) {
    ideas.push("décors futuristes et textures métalliques");
  }
  if (universe.includes("urb")) ideas.push("rue, néons et marche déterminée");
  if (keywords.some((k) => slugTag(k).includes("capuche"))) {
    ideas.push("silhouette marquante avec tenue forte");
  }

  ideas.push("ouverture immédiate avec image forte");
  ideas.push("alternance de plans courts et respirations");
  ideas.push("fin nette avec dernier plan mémorable");

  return normalizeSentenceList(ideas, 5, 80);
}

function buildEditingAdviceFromAnalysis(analysis = {}) {
  const mood = safeText(analysis.dominantMood).toLowerCase();
  const energy = safeText(analysis.energyLevel).toLowerCase();

  const advice = [];

  if (energy.includes("haute")) {
    advice.push("enchaîner des plans courts et lisibles");
    advice.push("garder un rythme visuel soutenu");
  } else {
    advice.push("laisser respirer certains plans");
    advice.push("privilégier la fluidité des transitions");
  }

  if (mood.includes("cin")) advice.push("soigner l'ouverture et la fin");
  if (mood.includes("émotion")) advice.push("éviter de surcharger le montage");
  if (mood.includes("sombre")) advice.push("renforcer les contrastes et la profondeur");

  advice.push("éviter les médias trop proches visuellement");
  return normalizeSentenceList(advice, 5, 80);
}

function buildSoraDirectionFromAnalysis(analysis = {}) {
  const parts = [
    safeText(analysis.clipType) ? `Type de clip : ${analysis.clipType}` : "",
    safeText(analysis.visualUniverse) ? `Univers : ${analysis.visualUniverse}` : "",
    safeText(analysis.artisticDirection) ? `Direction : ${analysis.artisticDirection}` : "",
    analysis.hookMoments?.length ? `Moments forts : ${analysis.hookMoments.join(", ")}` : ""
  ].filter(Boolean);

  return compactParagraph(parts.join(" | "), 260);
}

function buildClipIdeasFromAnalysis(analysis = {}, style = "social") {
  const mood = safeText(analysis.dominantMood);
  const energy = safeText(analysis.energyLevel).toLowerCase();
  const visualUniverse = safeText(analysis.visualUniverse);
  const artisticDirection = safeText(analysis.artisticDirection);
  const hookMoments = Array.isArray(analysis.hookMoments) ? analysis.hookMoments : [];

  let cameraStyle = "caméra fluide et lisible";
  if (energy.includes("haute")) cameraStyle = "plans courts, caméra vive et impact immédiat";
  if (mood.toLowerCase().includes("émotion")) cameraStyle = "gros plans doux et mouvements lents";

  let colorPalette = "couleurs franches et contraste propre";
  if (mood.toLowerCase().includes("sombre")) colorPalette = "noir, bleu nuit, lumières froides";
  if (mood.toLowerCase().includes("cin")) colorPalette = "palette réaliste, contrastes cinématographiques";
  if (mood.toLowerCase().includes("émotion")) colorPalette = "tons doux, lumière naturelle, chaleur humaine";

  const storyArc = [];
  if (hookMoments.length) {
    storyArc.push(`ouverture : ${hookMoments[0]}`);
    if (hookMoments[1]) storyArc.push(`milieu : ${hookMoments[1]}`);
    if (hookMoments[2]) storyArc.push(`fin : ${hookMoments[2]}`);
  }

  if (!storyArc.length) {
    storyArc.push("ouverture forte");
    storyArc.push("montée progressive");
    storyArc.push("clôture marquante");
  }

  const shortPromptIdeas = [
    `Premier plan fort dans ${visualUniverse || "un univers cohérent"}`,
    `Mouvement caméra ${cameraStyle.toLowerCase()}`,
    `Fin impactante avec ${mood.toLowerCase() || "une ambiance forte"}`
  ];

  return {
    creativeDirection: compactParagraph(
      firstNonEmpty(
        artisticDirection,
        analysis.detailedSummary,
        "Clip court, lisible et marquant, pensé pour accrocher rapidement."
      ),
      220
    ),
    visualStyle: compactSentence(
      firstNonEmpty(visualUniverse, mood, style, "réaliste percutant"),
      70
    ),
    cameraStyle: compactSentence(cameraStyle, 80),
    colorPalette: compactSentence(colorPalette, 80),
    storyArc: normalizeSentenceList(storyArc, 4, 90),
    shortPromptIdeas: normalizeSentenceList(shortPromptIdeas, 3, 90)
  };
}

function preferredBlocksFromAnalysis(analysis = {}, clipIdeas = {}) {
  const text = [
    safeText(analysis.visualUniverse),
    safeText(analysis.dominantMood),
    safeText(analysis.clipType),
    safeText(clipIdeas.visualStyle),
    ...(analysis.keywords || []),
    ...(analysis.themes || [])
  ]
    .join(" ")
    .toLowerCase();

  const blocks = [];

  if (/(manga|anime|animé)/.test(text)) blocks.push("animé / manga");
  if (/(pixar|cartoon|dessin|stylisé)/.test(text)) blocks.push("pixar / cartoon");
  if (/(horreur|horror|zombie|monstre|effray)/.test(text)) blocks.push("horreur");
  if (/(science|futur|espace|spatial|fantasy|fantaisie|cyber|robot)/.test(text)) {
    blocks.push("science-fiction / fantaisie");
  }
  if (/(documentaire|reportage|réel|interview)/.test(text)) blocks.push("documentaire");
  if (/(moi|personnel|self|portrait)/.test(text)) blocks.push("moi");

  return normalizeKeywordList(blocks, 4).map((item) => item.toLowerCase());
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

function scoreCandidate(candidate, analysis, clipIdeas, aspectRatio, allowedBlocks) {
  const normalizedAllowedBlocks = (Array.isArray(allowedBlocks) ? allowedBlocks : [])
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean);

  const block = safeText(candidate.block).toLowerCase();
  const haystack = [
    block,
    safeText(candidate.label).toLowerCase(),
    ...(candidate.tags || []).map((item) => safeText(item).toLowerCase())
  ].join(" ");

  if (normalizedAllowedBlocks.length && !normalizedAllowedBlocks.includes(block)) {
    return -9999;
  }

  let score = 0;

  if (ratioCompatible(aspectRatio, candidate.ratio)) score += 4;
  else score -= 6;

  const preferredBlocks = preferredBlocksFromAnalysis(analysis, clipIdeas);
  if (preferredBlocks.includes(block)) score += 9;

  const words = normalizeKeywordList(
    [
      ...(analysis.keywords || []),
      ...(analysis.themes || []),
      ...(analysis.emotions || []),
      safeText(analysis.dominantMood),
      safeText(analysis.visualUniverse),
      safeText(clipIdeas.visualStyle)
    ],
    12
  )
    .map((item) => slugTag(item))
    .filter(Boolean);

  const haystackSlug = slugTag(haystack);

  for (const word of words) {
    if (word.length < 4) continue;
    if (haystackSlug.includes(word)) score += 2;
  }

  if (safeText(analysis.energyLevel).toLowerCase().includes("haute")) {
    if (safeText(candidate.mediaType).toLowerCase() === "video") score += 1;
  }

  return score;
}

function buildSelectedCandidatesLocal(candidates = [], options = {}) {
  const {
    analysis = {},
    clipIdeas = {},
    aspectRatio = "vertical",
    allowedBlocks = [],
    maxCount = MAX_RENDER_MEDIA
  } = options;

  const normalized = normalizeCandidates(candidates);

  const scored = normalized
    .map((candidate) => ({
      ...candidate,
      _score: scoreCandidate(candidate, analysis, clipIdeas, aspectRatio, allowedBlocks)
    }))
    .filter((candidate) => candidate._score > -9999)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a.order - b.order;
    });

  const source = scored.length ? scored : normalized;
  const result = [];
  const usedIds = new Set();
  const usedBlocks = new Set();

  for (const item of source) {
    if (usedIds.has(item.id)) continue;
    const block = safeText(item.block).toLowerCase();

    if (!usedBlocks.has(block)) {
      result.push(item);
      usedIds.add(item.id);
      usedBlocks.add(block);
    }

    if (result.length >= maxCount) return result;
  }

  for (const item of source) {
    if (usedIds.has(item.id)) continue;
    result.push(item);
    usedIds.add(item.id);
    if (result.length >= maxCount) return result;
  }

  return result.slice(0, maxCount);
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

function buildSelectionReasoning(analysis = {}, selectedCandidates = []) {
  const blocks = normalizeKeywordList(
    selectedCandidates.map((item) => safeText(item.block)),
    4
  );

  const mood = safeText(analysis.dominantMood);
  const universe = safeText(analysis.visualUniverse);

  const parts = [
    mood ? `ambiance ${mood.toLowerCase()}` : "",
    universe ? `univers ${universe.toLowerCase()}` : "",
    blocks.length ? `blocs retenus : ${blocks.join(", ")}` : "",
    "sélection locale diversifiée"
  ].filter(Boolean);

  return compactSentence(parts.join(" | "), 180);
}

function buildBetterTitle({ title, analysis, clipIdeas, style, projectType }) {
  const cleanTitle = safeText(title);
  if (!isGenericProjectTitle(cleanTitle)) return cleanTitle;

  const mood = safeText(analysis?.dominantMood || "").toLowerCase();
  const visual = safeText(clipIdeas?.visualStyle || analysis?.visualUniverse || "");

  if (projectType === "speech") {
    if (mood.includes("myst")) return "Voix mystérieuse intense";
    if (mood.includes("emotion")) return "Voix émotionnelle forte";
    return "Voix IA percutante";
  }

  if (mood.includes("cin")) return "Clip cinématique intense";
  if (mood.includes("sombre")) return "Clip sombre percutant";
  if (mood.includes("émotion") || mood.includes("emotion")) return "Clip émotionnel fort";
  if (visual) return `Clip ${capitalize(visual)}`;
  if (style) return `Clip ${capitalize(style)}`;
  return "Clip musical impactant";
}

function buildReadyToCopyMeta({
  title = "",
  projectType = "music",
  style = "",
  tone = "",
  voiceStyle = "",
  mode = "video",
  analysis = {},
  clipIdeas = {}
}) {
  const finalTitle = buildBetterTitle({
    title,
    analysis,
    clipIdeas,
    style,
    projectType
  });

  const description = compactSentence(
    firstNonEmpty(
      analysis?.detailedSummary,
      clipIdeas?.creativeDirection,
      analysis?.summary,
      projectType === "speech"
        ? "Une voix IA claire, propre et directement exploitable pour les réseaux."
        : "Un clip visuel fort avec une vraie identité et une montée immédiate."
    ),
    220
  );

  const tags = uniqueTags([
    projectType === "speech" ? "#voixia" : "#clipmusical",
    "#montageia",
    mode === "video" ? "#video" : "#image",
    analysis?.dominantMood ? `#${slugTag(analysis.dominantMood)}` : "",
    clipIdeas?.visualStyle ? `#${slugTag(clipIdeas.visualStyle)}` : "",
    analysis?.keywords?.[0] ? `#${slugTag(analysis.keywords[0])}` : "",
    "#shortvideo"
  ]).slice(0, 5);

  const general = [
    finalTitle,
    description,
    tags.join(" ")
  ].join("\n");

  const shortsTags = uniqueTags([
    projectType === "speech" ? "#voixia" : "#clipmusical",
    analysis?.dominantMood ? `#${slugTag(analysis.dominantMood)}` : "",
    "#shorts"
  ]).slice(0, 3);

  let shorts = `${finalTitle}\n${shortsTags.join(" ")}`.trim();
  if (shorts.length > 100) {
    shorts = `${compactSentence(finalTitle, 55)}\n${shortsTags.join(" ")}`.trim().slice(0, 100);
  }

  return {
    general,
    shorts,
    hashtags: tags
  };
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
    safeText(analysis?.artisticDirection) ||
    safeText(analysis?.soraDirection);
  const cleanLyrics = safeText(lyricsExcerpt);
  const cleanCamera = safeText(clipIdeas?.cameraStyle || "");
  const cleanMood = safeText(analysis?.dominantMood || "");

  while (cursor < end) {
    const next = Math.min(end, cursor + segmentDuration);

    const pieces = [
      `Scène ${index} pour "${cleanTitle}"`,
      `style ${cleanStyle}`,
      "rendu réaliste cohérent",
      cleanUniverse ? `univers : ${cleanUniverse}` : "",
      cleanMood ? `ambiance : ${cleanMood}` : "",
      cleanCamera ? `caméra : ${cleanCamera}` : "",
      cleanNotes ? `direction : ${cleanNotes}` : "",
      cleanLyrics ? `texte ou intention : ${cleanLyrics}` : "",
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
   OpenAI voix
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
      instructions: "Voix masculine énergique, punchy, vive."
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
    geminiClipIdeasEnabled: false,
    geminiSelectMediaEnabled: false,
    geminiSingleCallMode: true,
    cacheEnabled: ENABLE_PROJECT_CACHE,
    cacheSize: projectCache.size,
    renderQueueLength: renderQueue.length,
    renderRunning,
    geminiPreviewMaxSec: GEMINI_PREVIEW_MAX_SEC,
    geminiPreviewAudioBitrate: GEMINI_PREVIEW_AUDIO_BITRATE
  });
});

/* =========================
   Meta locale
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
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas =
      Object.keys(parseObjectSafe(req.body?.clipIdeas, {})).length
        ? parseObjectSafe(req.body?.clipIdeas, {})
        : buildClipIdeasFromAnalysis(analysis, style);

    const meta = buildReadyToCopyMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    log(id, "META LOCAL OK", title);

    res.json({
      ok: true,
      source: "local_from_analysis",
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
   Sous-titres locaux
========================= */
app.post("/api/subtitles/from-text", async (req, res) => {
  const id = req.reqId;

  try {
    const lyricsText = safeText(req.body?.lyricsText || req.body?.text || "");
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
      "SUBTITLES LOCAL OK",
      subtitles.enabled ? `${subtitles.segments.length} segments` : "none"
    );

    res.json({
      ok: true,
      source: subtitles.enabled ? "local" : "none",
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

    const allowedBlocks = parseArraySafe(
      req.body?.allowedBlocks || req.body?.allowedBlocksJson,
      []
    );

    const candidates = parseArraySafe(
      req.body?.candidates || req.body?.candidatesJson || req.body?.mediaManifestJson,
      []
    );

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
    let analysisSource = "none";
    let analysisError = "";

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

      const geminiResult = await geminiAnalyzeAudio({
        audioPath: geminiPreviewPath,
        audioMimeType: "audio/mpeg",
        title,
        context,
        style,
        id
      });

      analysis = geminiResult.analysis;
      analysisSource = geminiResult.source;
    } catch (error) {
      analysisError = error?.message || "Analyse Gemini impossible.";
      analysis = buildFallbackMusicAnalysis(title, style);
      analysisSource = "local_fallback";
      log(id, "GEMINI ANALYZE FAIL -> CONTINUE", analysisError);
    } finally {
      await removePathQuietly(geminiPreviewPath);
      geminiPreviewPath = "";
    }

    const clipIdeas = buildClipIdeasFromAnalysis(analysis, style);
    const clipIdeasSource = "local_from_analysis";
    log(id, "LOCAL CLIP IDEAS OK", title);

    const selectedCandidates = buildSelectedCandidatesLocal(candidates, {
      analysis,
      clipIdeas,
      aspectRatio,
      allowedBlocks,
      maxCount: MAX_RENDER_MEDIA
    });

    const mediaSelectionSource = "local_from_analysis";
    const selectionReasoning = buildSelectionReasoning(analysis, selectedCandidates);
    log(id, "LOCAL SELECT OK", `${title} / ${selectedCandidates.length} médias`);

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

    const meta = buildReadyToCopyMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });
    const metaSource = "local_from_analysis";
    log(id, "LOCAL META OK", title);

    const subtitles = buildSubtitlePayload({
      lyricsText: manualLyricsText,
      lyricsApprox:
        manualLyricsText || !safeText(analysis.transcription)
          ? analysis.lyricsApprox || []
          : analysis.lyricsApprox || [],
      startSec: audioStartSec,
      endSec: audioStartSec + durationSec
    });

    const subtitlesSource = subtitles.enabled ? "local_from_analysis" : "none";
    if (subtitles.enabled) {
      log(id, "LOCAL SUBTITLES OK", `${subtitles.segments.length} segments`);
    } else {
      log(id, "LOCAL SUBTITLES SKIP", "aucun texte");
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
        clipIdeasError: "",
        mediaSelectionError: "",
        metaError: "",
        subtitlesError: ""
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
   Plan montage local
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
    const allowedBlocks = parseArraySafe(req.body?.allowedBlocks, []);
    const durationSec = safeNumber(req.body?.durationSec, 30);
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas =
      Object.keys(parseObjectSafe(req.body?.clipIdeas, {})).length
        ? parseObjectSafe(req.body?.clipIdeas, {})
        : buildClipIdeasFromAnalysis(analysis, style);
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

    const selectedCandidates = buildSelectedCandidatesLocal(candidates, {
      analysis,
      clipIdeas,
      aspectRatio,
      allowedBlocks,
      maxCount: MAX_RENDER_MEDIA
    });

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

    const meta = buildReadyToCopyMeta({
      title,
      projectType,
      style,
      tone,
      mode,
      analysis,
      clipIdeas
    });

    const subtitles = buildSubtitlePayload({
      lyricsText,
      lyricsApprox: analysis?.lyricsApprox || [],
      startSec: subtitleStartSec,
      endSec: subtitleEndSec
    });

    log(id, "PLAN LOCAL OK", `${title} / ${selectedCandidates.length} médias`);

    res.json({
      ok: true,
      plan,
      general: meta.general,
      shorts: meta.shorts,
      subtitles,
      selectionReasoning: buildSelectionReasoning(analysis, selectedCandidates),
      source: {
        mediaSelection: "local_from_analysis",
        meta: "local_from_analysis",
        subtitles: subtitles.enabled ? "local" : "none",
        plan: "local"
      },
      warnings: {
        mediaSelectionError: ""
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
   Sora prompts locaux
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

    log(id, "SORA LOCAL OK", `${title} / ${prompts.length}`);

    res.json({
      ok: true,
      source: "local_from_analysis",
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
   Voix OpenAI
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
   Render vidéo
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
