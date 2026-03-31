import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri
} from "@google/genai";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

const UPLOAD_DIR = path.join(os.tmpdir(), "gemini-analysis-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1
  }
});

function safeText(value) {
  return (value || "").toString().trim();
}

function extractJsonObject(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch {}
}

function ensureGemini(res) {
  if (!ai) {
    res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY manquante dans les variables d’environnement"
    });
    return false;
  }
  return true;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Serveur Gemini opérationnel",
    model: GEMINI_MODEL
  });
});

app.post("/api/gemini/analyze-audio", upload.single("audio"), async (req, res) => {
  if (!ensureGemini(res)) return;

  let uploadedGeminiFileName = null;

  try {
    const audioFile = req.file;
    const title = safeText(req.body?.title) || "Audio sans titre";
    const context = safeText(req.body?.context) || "";
    const target = safeText(req.body?.target) || "clip vidéo musical";

    if (!audioFile) {
      return res.status(400).json({
        ok: false,
        error: "Aucun fichier audio reçu"
      });
    }

    const mimeType = audioFile.mimetype || "audio/mpeg";

    const uploadedFile = await ai.files.upload({
      file: audioFile.path,
      config: { mimeType }
    });

    uploadedGeminiFileName = uploadedFile.name;

    const prompt = `
Tu es un analyste audio expert pour création de clips musicaux et vidéos sociales.

Analyse ce fichier audio et réponds UNIQUEMENT en JSON valide.

Format exact :
{
  "title": "",
  "summary": "",
  "dominantMood": "",
  "energyLevel": "",
  "rhythmEstimate": "",
  "emotions": [],
  "visualUniverse": "",
  "sceneIdeas": [],
  "editingAdvice": [],
  "hookMoments": [],
  "soraDirection": ""
}

Règles :
- Réponse uniquement en français
- Pas de markdown
- Pas de texte avant ou après le JSON
- Sois concret
- Les tableaux doivent contenir des phrases courtes
- "energyLevel" doit être parmi : faible, moyen, fort, très fort
- "rhythmEstimate" doit être une estimation simple du type : lent, modéré, rapide, très rapide
- "hookMoments" doit contenir des moments ou passages marquants même si l’estimation reste approximative
- "sceneIdeas" doit contenir entre 4 et 8 idées
- "editingAdvice" doit contenir entre 4 et 8 conseils
- "soraDirection" doit être une direction claire pour générer un clip cohérent

Contexte utilisateur :
- titre : ${title}
- objectif : ${target}
- notes : ${context || "aucune note supplémentaire"}
`.trim();

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        prompt
      ])
    });

    const text = safeText(response.text);
    const parsed = extractJsonObject(text);

    if (!parsed) {
      return res.json({
        ok: true,
        source: "gemini-texte-brut",
        raw: text
      });
    }

    return res.json({
      ok: true,
      source: "gemini-json",
      analysis: parsed
    });
  } catch (error) {
    console.error("Erreur /api/gemini/analyze-audio :", error);
    return res.status(500).json({
      ok: false,
      error: "Impossible d’analyser cet audio avec Gemini"
    });
  } finally {
    if (uploadedGeminiFileName) {
      try {
        await ai.files.delete({ name: uploadedGeminiFileName });
      } catch {}
    }
    await removeFileQuietly(req.file?.path);
  }
});

app.post("/api/gemini/clip-ideas", async (req, res) => {
  if (!ensureGemini(res)) return;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const lyrics = safeText(req.body?.lyrics) || "";
    const analysis = req.body?.analysis || null;

    if (!lyrics && !analysis) {
      return res.status(400).json({
        ok: false,
        error: "Il faut au moins des paroles ou une analyse"
      });
    }

    const prompt = `
Tu es un directeur artistique expert en clips vidéo.

Réponds UNIQUEMENT en JSON valide.

Format exact :
{
  "creativeDirection": "",
  "visualStyle": "",
  "cameraStyle": "",
  "colorPalette": "",
  "storyArc": [],
  "shortPromptIdeas": []
}

Règles :
- Réponse uniquement en français
- Pas de markdown
- Pas de texte hors JSON
- "storyArc" = 5 à 8 étapes courtes
- "shortPromptIdeas" = 5 à 8 idées de prompts courts
- Le tout doit rester cohérent et exploitable pour un futur clip

Titre : ${title}

Paroles :
${lyrics || "Aucune parole fournie"}

Analyse disponible :
${analysis ? JSON.stringify(analysis, null, 2) : "Aucune analyse disponible"}
`.trim();

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt
    });

    const text = safeText(response.text);
    const parsed = extractJsonObject(text);

    if (!parsed) {
      return res.json({
        ok: true,
        source: "gemini-texte-brut",
        raw: text
      });
    }

    return res.json({
      ok: true,
      source: "gemini-json",
      result: parsed
    });
  } catch (error) {
    console.error("Erreur /api/gemini/clip-ideas :", error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de générer les idées de clip"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur Gemini démarré sur le port ${PORT}`);
});
