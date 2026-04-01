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

async function callGemini(parts, maxOutputTokens = 300) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante.");
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
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
        temperature: 0.4,
        maxOutputTokens,
        responseMimeType: "application/json"
      }
    })
  });

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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Serveur Gemini opérationnel",
    model: GEMINI_MODEL
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
Analyse cet audio pour un clip court.

Règles :
- Réponds en JSON valide
- Français uniquement
- Pas de markdown
- Sortie courte et utile
- Maximum 300 tokens de sortie

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
  "soraDirection": ""
}

Contexte projet :
${context}

Titre :
${title}
`.trim();

    const result = await callGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: file.mimetype || "audio/mpeg",
          data: base64
        }
      }
    ], 300);

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
Crée une idée de clip très courte à partir de cette analyse audio.

Règles :
- JSON valide
- Français uniquement
- Pas de markdown
- Maximum 300 tokens de sortie

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

    const result = await callGemini([{ text: prompt }], 300);

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
    const targetDurationSec = Number(req.body?.targetDurationSec || 30);
    const aspectRatio = safeText(req.body?.aspectRatio) || "vertical";
    const mediaSourceMode = safeText(req.body?.mediaSourceMode) || "single";
    const allowedBlocks = Array.isArray(req.body?.allowedBlocks) ? req.body.allowedBlocks : [];
    const analysis = req.body?.analysis || {};
    const clipIdeas = req.body?.clipIdeas || {};
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];

    if (!candidates.length) {
      return res.status(400).json({ ok: false, error: "Aucun média candidat." });
    }

    log(id, "SELECT MEDIA START", `${title} / ${candidates.length} candidats`);

    const prompt = `
Tu choisis les meilleurs médias pour un clip court.

Règles :
- JSON valide
- Français uniquement
- Pas de markdown
- Ne choisis que parmi les IDs fournis
- Priorité au bon ratio
- Priorité à la cohérence avec l'analyse
- Entre 3 et 6 médias maximum
- Maximum 300 tokens de sortie

Format exact :
{
  "selectedIds": [],
  "reasoning": ""
}

Projet :
- titre : ${title}
- durée : ${targetDurationSec}
- format : ${aspectRatio}
- source : ${mediaSourceMode}
- blocs autorisés : ${allowedBlocks.join(", ")}

Analyse :
${JSON.stringify(analysis)}

Idée clip :
${JSON.stringify(clipIdeas)}

Candidats :
${JSON.stringify(candidates)}
`.trim();

    const result = await callGemini([{ text: prompt }], 300);
    const selectedIds = Array.isArray(result.json?.selectedIds) ? result.json.selectedIds : [];

    res.json({
      ok: true,
      selectedIds,
      reasoning: safeText(result.json?.reasoning || result.raw || "")
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
