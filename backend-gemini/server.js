import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

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
    fileSize: 60 * 1024 * 1024,
    files: 10
  }
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* =========================
   Utils
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
  if (value === undefined || value === null || value === "") return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseObjectSafe(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return fallback;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

async function removePathQuietly(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {}
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

  const fencedAny = text.match(/```\s*([\s\S]*?)```/i);
  if (fencedAny?.[1]) {
    try {
      return JSON.parse(fencedAny[1]);
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  return null;
}

function slugTag(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
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
      ratio: safeText(item.ratio || item.aspectRatio || item.orientation || ""),
      block: safeText(item.block || item.collection || item.category || item.group || "vrac"),
      durationSec: safeNumber(item.durationSec || item.duration || 0, 0),
      label: safeText(item.label || item.name || item.fileName || `media_${index + 1}`)
    }));
}

function ratioCompatible(aspectRatio, candidateRatio) {
  const target = safeText(aspectRatio).toLowerCase();
  const ratio = safeText(candidateRatio).toLowerCase();

  if (!target || !ratio) return true;
  if (target === "vertical") return ratio !== "horizontal";
  if (target === "horizontal") return ratio !== "vertical";
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

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
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
        `${item.index}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${item.text}`
    )
    .join("\n\n");

  return {
    enabled: true,
    plainText: segments.map((item) => item.text).join("\n"),
    segments,
    srt
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

/* =========================
   Gemini call
========================= */
async function callGemini(parts, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante.");
  }

  const maxOutputTokens = Number(options.maxOutputTokens || 300);
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
   Routes
========================= */
app.get("/", (_req, res) => {
  res.status(200).send("Backend Gemini OK");
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Serveur Gemini opérationnel",
    model: GEMINI_MODEL,
    apiKeyConfigured: !!GEMINI_API_KEY
  });
});

app.post("/api/gemini/analyze-audio", upload.single("audio"), async (req, res) => {
  const id = req.reqId;
  const file = req.file;

  try {
    if (!file) {
      return res.status(400).json({ ok: false, error: "Audio manquant." });
    }

    const title = safeText(req.body?.title) || "Projet musique";
    const context = safeText(req.body?.context) || "";

    log(id, "ANALYZE AUDIO START", title);

    const base64 = (await fsp.readFile(file.path)).toString("base64");

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

    const result = await callGemini(
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
        maxOutputTokens: 500,
        temperature: 0.3
      }
    );

    await removePathQuietly(file.path);

    res.json({
      ok: true,
      analysis: result.json || { raw: result.raw || "Analyse vide." }
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

app.post("/api/gemini/clip-ideas", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet musique";
    const context = safeText(req.body?.context) || "";
    const analysis = parseObjectSafe(req.body?.analysis, {});

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
      maxOutputTokens: 450,
      temperature: 0.4
    });

    res.json({
      ok: true,
      result: result.json || { raw: result.raw || "Idée vide." }
    });
  } catch (error) {
    console.error(`[${id}] CLIP IDEAS ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de créer l’idée de clip."
    });
  }
});

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

    log(id, "SELECT MEDIA START", `${title} / ${candidates.length} candidats`);

    const prompt = `
Tu choisis les meilleurs médias pour un clip court.

Objectif :
- produire une sélection VARIÉE et pertinente
- éviter de prendre automatiquement les premiers médias
- éviter de toujours choisir les mêmes blocs
- si plusieurs médias se ressemblent, n'en prends qu'un
- mélange intelligemment les blocs quand c'est utile
- garde un ordre final cohérent pour le montage

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
      maxOutputTokens: 450,
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

    res.json({
      ok: true,
      selectedIds,
      reasoning
    });
  } catch (error) {
    console.error(`[${id}] SELECT MEDIA ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de sélectionner les médias."
    });
  }
});

app.post("/api/gemini/metadata", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const projectType = safeText(req.body?.projectType) || "music";
    const style = safeText(req.body?.style) || "créatif";
    const tone = safeText(req.body?.tone) || "normal";
    const voiceStyle = safeText(req.body?.voiceStyle) || "";
    const mode = safeText(req.body?.mode) || "video";
    const analysis = parseObjectSafe(req.body?.analysis, {});
    const clipIdeas = parseObjectSafe(req.body?.clipIdeas, {});

    log(id, "GEMINI META START", `${title} / ${projectType}`);

    const prompt = `
Crée des métadonnées réseaux sociaux en français.

Objectif :
- 1 bloc général
- 1 bloc YouTube Shorts
- titre plus fort et plus vendeur
- texte plus varié
- pas trop générique
- hashtags propres

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Le bloc shorts doit rester court
- Maximum 5 hashtags pour chaque bloc
- Le titre YouTube Shorts doit être clair et visible

Format exact :
{
  "generalTitle": "",
  "generalDescription": "",
  "generalHashtags": [],
  "shortsTitle": "",
  "shortsDescription": "",
  "shortsHashtags": []
}

Projet :
- titre : ${title}
- type : ${projectType}
- style : ${style}
- ton : ${tone}
- mode : ${mode}
- voix : ${voiceStyle}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}
`.trim();

    const result = await callGemini([{ text: prompt }], {
      maxOutputTokens: 500,
      temperature: 0.55
    });

    const json = result.json || {};
    const fallback = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    const generalTitle = safeText(json.generalTitle) || title;
    const generalDescription = safeText(json.generalDescription) || "";
    const generalHashtags = parseArraySafe(json.generalHashtags, []).slice(0, 5);

    const shortsTitle = safeText(json.shortsTitle) || title;
    const shortsDescription = safeText(json.shortsDescription) || "";
    const shortsHashtags = parseArraySafe(json.shortsHashtags, []).slice(0, 5);

    const general =
      generalTitle || generalDescription || generalHashtags.length
        ? `${generalTitle}
${generalDescription}
${generalHashtags.map((tag) => (String(tag).startsWith("#") ? tag : `#${slugTag(tag)}`)).join(" ")}`
        : fallback.general;

    const shortsRaw =
      shortsTitle || shortsDescription || shortsHashtags.length
        ? `${shortsTitle}
${shortsDescription}
${shortsHashtags.map((tag) => (String(tag).startsWith("#") ? tag : `#${slugTag(tag)}`)).join(" ")}`
        : fallback.shorts;

    res.json({
      ok: true,
      general: general.trim(),
      shorts: shortsRaw.trim().slice(0, 100)
    });
  } catch (error) {
    console.error(`[${id}] GEMINI META ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de générer les métadonnées."
    });
  }
});

app.post("/api/gemini/subtitles", async (req, res) => {
  const id = req.reqId;

  try {
    const lyricsText = safeText(req.body?.lyricsText || "");
    const lyricsApprox = parseArraySafe(req.body?.lyricsApprox, []);
    const startSec = safeNumber(req.body?.startSec, 0);
    const endSec = safeNumber(req.body?.endSec, 30);

    log(id, "GEMINI SUBTITLES BUILD", `start=${startSec} end=${endSec}`);

    const subtitles = buildSubtitlePayload({
      lyricsText,
      lyricsApprox,
      startSec,
      endSec
    });

    res.json({
      ok: true,
      subtitles
    });
  } catch (error) {
    console.error(`[${id}] GEMINI SUBTITLES ERROR`, error);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de générer les sous-titres."
    });
  }
});

app.post("/api/gemini/prepare-project", upload.single("audio"), async (req, res) => {
  const id = req.reqId;
  const file = req.file;

  try {
    if (!file) {
      return res.status(400).json({ ok: false, error: "Audio manquant." });
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
    const allowedBlocks = normalizeAllowedBlocks(parseArraySafe(req.body?.allowedBlocks));
    const candidates = normalizeCandidates(parseArraySafe(req.body?.candidates));
    const startSec = safeNumber(req.body?.startSec, 0);
    const endSec = safeNumber(req.body?.endSec, 30);

    log(id, "PREPARE PROJECT START", `${title} / ${candidates.length} candidats`);

    const base64 = (await fsp.readFile(file.path)).toString("base64");

    const analysisPrompt = `
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

    const analysisResult = await callGemini(
      [
        { text: analysisPrompt },
        {
          inlineData: {
            mimeType: file.mimetype || "audio/mpeg",
            data: base64
          }
        }
      ],
      {
        maxOutputTokens: 500,
        temperature: 0.3
      }
    );

    const analysis = analysisResult.json || {};

    const clipPrompt = `
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

    const clipResult = await callGemini([{ text: clipPrompt }], {
      maxOutputTokens: 450,
      temperature: 0.4
    });

    const clipIdeas = clipResult.json || {};

    let selectedIds = diversifiedFallbackSelectedIds(candidates, aspectRatio, allowedBlocks);
    let selectionReasoning = "Sélection diversifiée locale.";

    if (candidates.length) {
      const selectPrompt = `
Tu choisis les meilleurs médias pour un clip court.

Objectif :
- produire une sélection VARIÉE et pertinente
- éviter de prendre automatiquement les premiers médias
- éviter de toujours choisir les mêmes blocs
- si plusieurs médias se ressemblent, n'en prends qu'un
- mélange intelligemment les blocs quand c'est utile
- garde un ordre final cohérent pour le montage

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

      const selectResult = await callGemini([{ text: selectPrompt }], {
        maxOutputTokens: 450,
        temperature: 0.35
      });

      const normalized = normalizeSelectedIds(selectResult.json?.selectedIds, candidates);
      if (normalized.length >= Math.min(3, candidates.length)) {
        selectedIds = normalized;
        selectionReasoning = safeText(selectResult.json?.reasoning || "");
      }
    }

    const metaJsonPrompt = `
Crée des métadonnées réseaux sociaux en français.

Objectif :
- 1 bloc général
- 1 bloc YouTube Shorts
- titre plus fort et plus vendeur
- texte plus varié
- pas trop générique
- hashtags propres

Règles :
- JSON valide uniquement
- Français uniquement
- Pas de markdown
- Le bloc shorts doit rester court
- Maximum 5 hashtags pour chaque bloc
- Le titre YouTube Shorts doit être clair et visible

Format exact :
{
  "generalTitle": "",
  "generalDescription": "",
  "generalHashtags": [],
  "shortsTitle": "",
  "shortsDescription": "",
  "shortsHashtags": []
}

Projet :
- titre : ${title}
- type : ${projectType}
- style : ${style}
- ton : ${tone}
- mode : ${mode}
- voix : ${voiceStyle}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}
`.trim();

    const metaResult = await callGemini([{ text: metaJsonPrompt }], {
      maxOutputTokens: 500,
      temperature: 0.55
    });

    const metaJson = metaResult.json || {};
    const fallbackMeta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    const generalTitle = safeText(metaJson.generalTitle) || title;
    const generalDescription = safeText(metaJson.generalDescription) || "";
    const generalHashtags = parseArraySafe(metaJson.generalHashtags, []).slice(0, 5);
    const shortsTitle = safeText(metaJson.shortsTitle) || title;
    const shortsDescription = safeText(metaJson.shortsDescription) || "";
    const shortsHashtags = parseArraySafe(metaJson.shortsHashtags, []).slice(0, 5);

    const general =
      generalTitle || generalDescription || generalHashtags.length
        ? `${generalTitle}
${generalDescription}
${generalHashtags.map((tag) => (String(tag).startsWith("#") ? tag : `#${slugTag(tag)}`)).join(" ")}`
        : fallbackMeta.general;

    const shorts =
      shortsTitle || shortsDescription || shortsHashtags.length
        ? `${shortsTitle}
${shortsDescription}
${shortsHashtags.map((tag) => (String(tag).startsWith("#") ? tag : `#${slugTag(tag)}`)).join(" ")}`
            .trim()
            .slice(0, 100)
        : fallbackMeta.shorts;

    const subtitles = buildSubtitlePayload({
      lyricsText: "",
      lyricsApprox: analysis?.lyricsApprox || [],
      startSec,
      endSec
    });

    await removePathQuietly(file.path);

    res.json({
      ok: true,
      analysis,
      clipIdeas,
      selectedIds,
      reasoning: selectionReasoning,
      general: general.trim(),
      shorts: shorts.trim(),
      subtitles
    });
  } catch (error) {
    console.error(`[${id}] PREPARE PROJECT ERROR`, error);
    await removePathQuietly(file?.path);
    res.status(500).json({
      ok: false,
      error: error.message || "Impossible de préparer le projet."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur Gemini démarré sur le port ${PORT}`);
});
