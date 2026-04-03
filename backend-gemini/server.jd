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

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const genericFence = text.match(/```\s*([\s\S]*?)```/i);
  if (genericFence?.[1]) {
    try {
      return JSON.parse(genericFence[1]);
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
      ratio: safeText(item.ratio || item.aspectRatio || ""),
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
    const analysis = req.body?.analysis || {};

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
    const analysis = req.body?.analysis || {};
    const clipIdeas = req.body?.clipIdeas || {};
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

app.listen(PORT, () => {
  console.log(`Serveur Gemini démarré sur le port ${PORT}`);
});
