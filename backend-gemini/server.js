import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const TMP_ROOT = path.join(os.tmpdir(), "gemini-analysis-backend");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 10
  }
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* =========================
   Base utils
========================= */
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

function parseArraySafe(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseObjectSafe(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonSafe(text) {
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

async function removePathQuietly(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {}
}

function sha1Buffer(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function stableStringify(value) {
  try {
    return JSON.stringify(value, jsonStableReplacer);
  } catch {
    return JSON.stringify(value);
  }
}

function jsonStableReplacer(_key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
}

function uniqueArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

/* =========================
   Simple memory cache
========================= */
const CACHE_TTL_MS = 10 * 60 * 1000;
const resultCache = new Map();

function getCache(key) {
  const item = resultCache.get(key);
  if (!item) return null;

  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }

  return item.data;
}

function setCache(key, data) {
  resultCache.set(key, {
    createdAt: Date.now(),
    data
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, item] of resultCache.entries()) {
    if (now - item.createdAt > CACHE_TTL_MS) {
      resultCache.delete(key);
    }
  }
}, 60 * 1000).unref?.();

/* =========================
   Anti doublon / file d'attente
========================= */
const inflightRequests = new Map();
const analysisQueue = [];
let analysisRunning = false;

function createInflightKey(kind, payload) {
  return `${kind}:${crypto
    .createHash("sha1")
    .update(typeof payload === "string" ? payload : JSON.stringify(payload))
    .digest("hex")}`;
}

function withInflightDedup(key, taskFactory) {
  const existing = inflightRequests.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await taskFactory();
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

function enqueueExclusiveAnalysis(task) {
  return new Promise((resolve, reject) => {
    analysisQueue.push({ task, resolve, reject });
    processAnalysisQueue().catch((error) => {
      console.error("QUEUE ERROR", error);
    });
  });
}

async function processAnalysisQueue() {
  if (analysisRunning) return;
  const next = analysisQueue.shift();
  if (!next) return;

  analysisRunning = true;

  try {
    const result = await next.task();
    next.resolve(result);
  } catch (error) {
    next.reject(error);
  } finally {
    analysisRunning = false;
    if (analysisQueue.length) {
      processAnalysisQueue().catch((error) => {
        console.error("QUEUE LOOP ERROR", error);
      });
    }
  }
}

/* =========================
   Gemini call
========================= */
async function callGemini(parts, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante.");
  }

  const maxOutputTokens = Number(options.maxOutputTokens || 500);
  const temperature = Number(options.temperature ?? 0.35);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
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
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Erreur Gemini");
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((item) => item.text || "").join("").trim() || "";

  return {
    raw: text,
    json: parseJsonSafe(text)
  };
}

/* =========================
   Helpers média
========================= */
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
      ratio: safeText(item.ratio || item.aspectRatio || item.orientation || ""),
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

/* =========================
   Helpers texte
========================= */
function slugTag(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
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

function buildSubtitlePayloadLocal({
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

function buildLocalMeta({
  title = "Projet",
  projectType = "music",
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
  const mood = safeText(analysis?.dominantMood || tone || style || "créatif");
  const visual = safeText(
    clipIdeas?.visualStyle ||
      analysis?.visualUniverse ||
      style ||
      "cinematique"
  );
  const hashtags = uniqueArray([
    projectType === "speech" ? "#voixia" : "#clipmusical",
    "#montageia",
    mood ? `#${slugTag(mood)}` : "",
    visual ? `#${slugTag(visual)}` : "",
    mode === "video" ? "#video" : "#image"
  ]).filter(Boolean);

  const descriptionParts = [
    summary,
    mood ? `Ambiance : ${mood}.` : "",
    visual ? `Univers visuel : ${visual}.` : "",
    projectType === "speech" && voiceStyle ? `Voix : ${voiceStyle}.` : ""
  ].filter(Boolean);

  const general = `${cleanTitle}
${descriptionParts.join(" ")}
${hashtags.join(" ")}`;

  const shorts = `${cleanTitle}
${[hashtags[0], hashtags[1], hashtags[2]].filter(Boolean).join(" ")}`.slice(0, 100);

  return {
    general,
    shorts,
    keywords: uniqueArray([mood, visual, projectType, style]).filter(Boolean),
    hashtags
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
   Health
========================= */
app.get("/", (_req, res) => {
  res.status(200).send("Backend Gemini OK");
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Serveur Gemini opérationnel",
    model: GEMINI_MODEL,
    apiKeyConfigured: !!GEMINI_API_KEY,
    queueLength: analysisQueue.length,
    analysisRunning
  });
});

/* =========================
   Analyze audio
========================= */
app.post("/api/gemini/analyze-audio", upload.single("audio"), async (req, res) => {
  const id = req.reqId;
  const file = req.file;

  try {
    if (!file) {
      return res.status(400).json({ ok: false, error: "Audio manquant." });
    }

    const title = safeText(req.body?.title) || "Projet musique";
    const context = safeText(req.body?.context) || "";

    const buffer = await fsp.readFile(file.path);
    const audioHash = sha1Buffer(buffer);

    const cacheKey = createInflightKey("analyze-cache", {
      title,
      context,
      audioHash
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "ANALYZE AUDIO CACHE HIT", title);
      await removePathQuietly(file.path);
      return res.json({
        ok: true,
        analysis: cached,
        source: "cache"
      });
    }

    const inflightKey = createInflightKey("analyze-inflight", {
      title,
      context,
      audioHash
    });

    const result = await withInflightDedup(inflightKey, async () => {
      return enqueueExclusiveAnalysis(async () => {
        log(id, "ANALYZE AUDIO START", `${title} | queue=${analysisQueue.length}`);

        const base64 = buffer.toString("base64");

        const prompt = `
Analyse cet audio pour préparer un clip court musical.

Règles :
- Réponds en JSON valide uniquement
- Français uniquement
- Pas de markdown
- Sortie utile, concrète, concise
- Si tu comprends des paroles, donne des lignes approximatives
- N'invente pas si ce n'est pas audible

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

Contexte projet :
${context}

Titre :
${title}
`.trim();

        const geminiResult = await callGemini(
          [
            { text: prompt },
            {
              inlineData: {
                mimeType: file.mimetype || "audio/mpeg",
                data: base64
              }
            }
          ],
          {
            maxOutputTokens: 600,
            temperature: 0.3
          }
        );

        const analysis =
          geminiResult.json || {
            summary: `Analyse de "${title}"`,
            dominantMood: "énergique",
            energyLevel: "moyenne",
            rhythmEstimate: "rythme court et dynamique",
            visualUniverse: "univers clip musical",
            emotions: [],
            hookMoments: [],
            sceneIdeas: [],
            editingAdvice: [],
            soraDirection: "",
            lyricsApprox: []
          };

        setCache(cacheKey, analysis);

        log(id, "ANALYZE AUDIO OK", title);

        return analysis;
      });
    });

    await removePathQuietly(file.path);

    res.json({
      ok: true,
      analysis: result,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] ANALYZE AUDIO ERROR`, error);
    await removePathQuietly(file?.path);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible d’analyser l’audio."
    });
  }
});

/* =========================
   Clip ideas
========================= */
app.post("/api/gemini/clip-ideas", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet musique";
    const context = safeText(req.body?.context) || "";
    const analysis = parseObjectSafe(req.body?.analysis, {});

    const cacheKey = createInflightKey("clip-ideas-cache", {
      title,
      context,
      analysis: stableStringify(analysis)
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "CLIP IDEAS CACHE HIT", title);
      return res.json({
        ok: true,
        result: cached,
        source: "cache"
      });
    }

    log(id, "CLIP IDEAS START", title);

    const prompt = `
Crée une idée de clip musicale courte, forte et cohérente à partir de cette analyse audio.

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Donne une direction visuelle exploitable
- Reste concret
- Maximum 6 étapes dans l'arc narratif

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

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 500,
      temperature: 0.4
    });

    const payload =
      result.json || {
        creativeDirection: `Clip court autour du projet "${title}"`,
        visualStyle: "dynamique réseaux sociaux",
        cameraStyle: "plans courts et lisibles",
        colorPalette: "couleurs franches et contrastées",
        storyArc: ["Ouverture directe", "Montée progressive", "Final mémorable"],
        shortPromptIdeas: ["Plan fort", "Alternance de blocs", "Final propre"]
      };

    setCache(cacheKey, payload);

    log(id, "CLIP IDEAS OK", title);

    res.json({
      ok: true,
      result: payload,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] CLIP IDEAS ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de créer l’idée de clip."
    });
  }
});

/* =========================
   Select media
========================= */
app.post("/api/gemini/select-media", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet musique";
    const targetDurationSec = safeNumber(req.body?.targetDurationSec, 30);
    const aspectRatio = safeText(req.body?.aspectRatio) || "vertical";
    const mediaSourceMode = safeText(req.body?.mediaSourceMode) || "single";
    const allowedBlocks = normalizeAllowedBlocks(req.body?.allowedBlocks);
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, {});
    const candidates = normalizeCandidates(req.body?.candidates);

    if (!candidates.length) {
      return res.status(400).json({ ok: false, error: "Aucun média candidat." });
    }

    const cacheKey = createInflightKey("select-media-cache", {
      title,
      targetDurationSec,
      aspectRatio,
      mediaSourceMode,
      allowedBlocks,
      analysis: stableStringify(analysis),
      clipIdeas: stableStringify(clipIdeas),
      candidates: stableStringify(candidates)
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "SELECT MEDIA CACHE HIT", `${title} / ${candidates.length}`);
      return res.json({
        ok: true,
        selectedIds: cached.selectedIds,
        reasoning: cached.reasoning,
        source: "cache"
      });
    }

    log(id, "SELECT MEDIA START", `${title} / ${candidates.length} candidats`);

    const prompt = `
Tu choisis les meilleurs médias pour un clip court.

Objectif :
- produire une sélection variée et pertinente
- éviter de prendre automatiquement les premiers médias
- garder un ordre final de montage cohérent
- si plusieurs médias se ressemblent, n'en prends qu'un

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Ne choisis que parmi les IDs fournis
- Choisis entre 3 et 6 médias
- Priorité à la cohérence avec l'analyse
- Priorité au bon ratio
- Priorité à la variété des blocs et des plans
- Retourne les IDs dans l'ordre final souhaité du montage

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
${JSON.stringify(candidates)}
`.trim();

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 500,
      temperature: 0.35
    });

    let selectedIds = normalizeSelectedIds(result.json?.selectedIds, candidates);
    let reasoning = safeText(result.json?.reasoning || result.raw || "");

    if (selectedIds.length < Math.min(3, candidates.length)) {
      selectedIds = diversifiedFallbackSelectedIds(candidates, aspectRatio, allowedBlocks);
      reasoning = reasoning
        ? `${reasoning} | Fallback diversifié appliqué.`
        : "Fallback diversifié appliqué.";
    }

    const payload = { selectedIds, reasoning };
    setCache(cacheKey, payload);

    log(id, "SELECT MEDIA OK", `${title} / ${selectedIds.length} médias`);

    res.json({
      ok: true,
      selectedIds,
      reasoning,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] SELECT MEDIA ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de sélectionner les médias."
    });
  }
});

/* =========================
   Meta generate
========================= */
app.post("/api/gemini/meta-generate", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const style = safeText(req.body?.style) || "créatif";
    const projectType = safeText(req.body?.projectType) || "music";
    const tone = safeText(req.body?.tone) || "normal";
    const voiceStyle = safeText(req.body?.voiceStyle) || "";
    const mode = safeText(req.body?.mode) || "video";
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, {});

    const cacheKey = createInflightKey("meta-cache", {
      title,
      style,
      projectType,
      tone,
      voiceStyle,
      mode,
      analysis: stableStringify(analysis),
      clipIdeas: stableStringify(clipIdeas)
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "META CACHE HIT", title);
      return res.json({
        ok: true,
        ...cached,
        source: "cache"
      });
    }

    log(id, "META START", `${title} / ${projectType}`);

    const prompt = `
Crée des métadonnées sociales percutantes en français.

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Le bloc "general" doit contenir 3 lignes :
  1. un titre court
  2. une description courte optimisée social
  3. des hashtags sur une seule ligne
- Le bloc "shorts" doit tenir en 100 caractères maximum
- Les hashtags doivent être courts, lisibles et cohérents
- Pas de répétitions inutiles
- Pas d'invention absurde

Format exact :
{
  "general": "",
  "shorts": "",
  "keywords": [],
  "hashtags": []
}

Projet :
- titre : ${title}
- type : ${projectType}
- style : ${style}
- ton : ${tone}
- voix : ${voiceStyle || "aucune"}
- mode : ${mode}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}
`.trim();

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 350,
      temperature: 0.45
    });

    const payload = result.json || buildLocalMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    const cleanPayload = {
      general: safeText(payload.general || ""),
      shorts: safeText(payload.shorts || "").slice(0, 100),
      keywords: Array.isArray(payload.keywords) ? payload.keywords.map((v) => safeText(v)).filter(Boolean) : [],
      hashtags: Array.isArray(payload.hashtags) ? payload.hashtags.map((v) => safeText(v)).filter(Boolean) : []
    };

    if (!cleanPayload.general || !cleanPayload.shorts) {
      const fallback = buildLocalMeta({
        title,
        projectType,
        style,
        tone,
        voiceStyle,
        mode,
        analysis,
        clipIdeas
      });

      cleanPayload.general = cleanPayload.general || fallback.general;
      cleanPayload.shorts = cleanPayload.shorts || fallback.shorts;
      cleanPayload.keywords = cleanPayload.keywords.length ? cleanPayload.keywords : fallback.keywords;
      cleanPayload.hashtags = cleanPayload.hashtags.length ? cleanPayload.hashtags : fallback.hashtags;
    }

    setCache(cacheKey, cleanPayload);

    log(id, "META OK", title);

    res.json({
      ok: true,
      ...cleanPayload,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] META ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de générer les métadonnées."
    });
  }
});

/* =========================
   Subtitles from text
========================= */
app.post("/api/gemini/subtitles-from-text", async (req, res) => {
  const id = req.reqId;

  try {
    const lyricsText = safeText(req.body?.lyricsText || req.body?.text || "");
    const lyricsApprox = parseArraySafe(req.body?.lyricsApprox, []);
    const startSec = safeNumber(req.body?.startSec, 0);
    const endSec = safeNumber(req.body?.endSec, 30);

    const sourceText = normalizeLyricsLines(lyricsText).length
      ? normalizeLyricsLines(lyricsText).join("\n")
      : normalizeLyricsLines(lyricsApprox).join("\n");

    if (!sourceText) {
      return res.json({
        ok: true,
        subtitles: {
          enabled: false,
          plainText: "",
          segments: [],
          srt: ""
        },
        source: "none"
      });
    }

    const cacheKey = createInflightKey("subtitles-cache", {
      sourceText,
      startSec,
      endSec
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "SUBTITLES CACHE HIT");
      return res.json({
        ok: true,
        subtitles: cached,
        source: "cache"
      });
    }

    log(id, "SUBTITLES START", `${startSec}-${endSec}`);

    const prompt = `
Découpe ce texte en sous-titres courts et lisibles.

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Chaque segment doit être court
- Garde le sens
- Pas de texte inventé
- Donne des ratios de durée simples

Format exact :
{
  "segments": [
    { "text": "", "durationRatio": 1 }
  ]
}

Texte :
${sourceText}
`.trim();

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 500,
      temperature: 0.25
    });

    const rawSegments = Array.isArray(result.json?.segments) ? result.json.segments : [];
    const duration = Math.max(0, endSec - startSec);

    let subtitles = null;

    if (rawSegments.length && duration > 0) {
      const cleaned = rawSegments
        .map((item) => ({
          text: safeText(item?.text || ""),
          durationRatio: Math.max(1, safeNumber(item?.durationRatio, 1))
        }))
        .filter((item) => item.text);

      const totalRatio = cleaned.reduce((sum, item) => sum + item.durationRatio, 0) || cleaned.length;
      let cursor = Number(startSec || 0);

      const segments = cleaned.map((item, index) => {
        const isLast = index === cleaned.length - 1;
        const partDuration = isLast
          ? Number((endSec - cursor).toFixed(3))
          : Number(((duration * item.durationRatio) / totalRatio).toFixed(3));

        const segment = {
          index: index + 1,
          start: Number(cursor.toFixed(3)),
          end: Number((cursor + partDuration).toFixed(3)),
          text: item.text
        };

        cursor = segment.end;
        return segment;
      });

      if (segments.length) {
        segments[segments.length - 1].end = Number(endSec.toFixed(3));
      }

      const srt = segments
        .map(
          (item) =>
            `${item.index}
${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}
${item.text}`
        )
        .join("\n\n");

      subtitles = {
        enabled: true,
        plainText: segments.map((item) => item.text).join("\n"),
        segments,
        srt
      };
    }

    if (!subtitles) {
      subtitles = buildSubtitlePayloadLocal({
        lyricsText,
        lyricsApprox,
        startSec,
        endSec
      });
    }

    setCache(cacheKey, subtitles);

    log(id, "SUBTITLES OK", subtitles.enabled ? `${subtitles.segments.length} segments` : "aucun");

    res.json({
      ok: true,
      subtitles,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] SUBTITLES ERROR`, error);

    const fallback = buildSubtitlePayloadLocal({
      lyricsText: safeText(req.body?.lyricsText || req.body?.text || ""),
      lyricsApprox: parseArraySafe(req.body?.lyricsApprox, []),
      startSec: safeNumber(req.body?.startSec, 0),
      endSec: safeNumber(req.body?.endSec, 30)
    });

    res.json({
      ok: true,
      subtitles: fallback,
      source: fallback.enabled ? "local_fallback" : "none"
    });
  }
});

/* =========================
   Sora prompts
========================= */
app.post("/api/gemini/sora-prompts", async (req, res) => {
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

    const cacheKey = createInflightKey("sora-prompts-cache", {
      title,
      start,
      end,
      segmentDuration,
      style,
      universe,
      notes,
      lyricsExcerpt,
      analysis: stableStringify(analysis),
      clipIdeas: stableStringify(clipIdeas)
    });

    const cached = getCache(cacheKey);
    if (cached) {
      log(id, "SORA PROMPTS CACHE HIT", title);
      return res.json({
        ok: true,
        prompts: cached,
        source: "cache"
      });
    }

    log(id, "SORA PROMPTS START", title);

    const segmentCount = Math.ceil(total / segmentDuration);

    const prompt = `
Crée une série de prompts vidéo courts en français.

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Donne exactement ${segmentCount} prompts
- Chaque prompt doit être exploitable pour une scène vidéo
- Garde une continuité narrative
- Les prompts doivent rester concrets et visuels
- Le champ "start" et "end" doit respecter la chronologie demandée

Format exact :
{
  "prompts": [
    {
      "index": 1,
      "start": 0,
      "end": 10,
      "prompt": ""
    }
  ]
}

Projet :
- titre : ${title}
- début : ${start}
- fin : ${end}
- durée par segment : ${segmentDuration}
- style : ${style}
- univers : ${universe}
- notes : ${notes}
- extrait paroles : ${lyricsExcerpt}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}
`.trim();

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 900,
      temperature: 0.45
    });

    let prompts = Array.isArray(result.json?.prompts) ? result.json.prompts : [];

    prompts = prompts
      .map((item, index) => ({
        index: safeNumber(item?.index, index + 1),
        start: safeNumber(item?.start, start + index * segmentDuration),
        end: safeNumber(item?.end, Math.min(end, start + (index + 1) * segmentDuration)),
        prompt: safeText(item?.prompt || "")
      }))
      .filter((item) => item.prompt);

    if (!prompts.length) {
      prompts = buildLocalSoraPrompts({
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
    }

    setCache(cacheKey, prompts);

    log(id, "SORA PROMPTS OK", `${title} / ${prompts.length}`);

    res.json({
      ok: true,
      prompts,
      source: "gemini"
    });
  } catch (error) {
    console.error(`[${id}] SORA PROMPTS ERROR`, error);

    const prompts = buildLocalSoraPrompts({
      title: safeText(req.body?.title) || "Projet vidéo",
      start: safeNumber(req.body?.start, 0),
      end: safeNumber(req.body?.end, 10),
      segmentDuration: Math.max(1, safeNumber(req.body?.segmentDuration, 10)),
      style: safeText(req.body?.style) || "realisme",
      universe: safeText(req.body?.universe || ""),
      notes: safeText(req.body?.notes || ""),
      lyricsExcerpt: safeText(req.body?.lyricsExcerpt || ""),
      analysis: parseObjectSafe(req.body?.analysis, {}),
      clipIdeas: parseObjectSafe(req.body?.clipIdeas, {})
    });

    res.json({
      ok: true,
      prompts,
      source: "local_fallback"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur Gemini démarré sur le port ${PORT}`);
});
