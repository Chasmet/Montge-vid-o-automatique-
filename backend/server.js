import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

/* =========================
   Helpers
========================= */
function ensureOpenAI(res) {
  if (!client) {
    res.status(500).json({
      ok: false,
      error: "OPENAI_API_KEY manquante dans le fichier .env"
    });
    return false;
  }
  return true;
}

function safeText(value) {
  return (value || "").toString().trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return `${safe.toFixed(1).replace(".0", "")} s`;
  const m = Math.floor(safe / 60);
  const s = Math.round(safe % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeHashtags(tags) {
  return tags
    .map((tag) => tag.replace(/[^a-zA-Z0-9àâäéèêëïîôöùûüç]/gi, ""))
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.toLowerCase()}`));
}

function buildFallbackMeta({
  projectType = "music",
  title = "Mon projet",
  style = "cinématique",
  mode = "video",
  tone = "normal",
  voice = "male"
}) {
  const cleanTitle = safeText(title) || "Mon projet";
  const mainTags = makeHashtags([
    "MontageIA",
    projectType,
    style,
    mode,
    tone,
    voice === "female" ? "voixfeminine" : "voixmasculine"
  ]);

  const general = `${cleanTitle}
Montage ${projectType === "speech" ? "speech" : "musique"}, style ${style}, mode ${mode}.
${mainTags.slice(0, 5).join(" ")}`;

  const shorts = `${cleanTitle}
${mainTags.slice(0, 2).join(" ")}`.slice(0, 99);

  return { general, shorts };
}

function createSoraSegments(start, end, segmentDuration) {
  const segments = [];
  let cursor = start;
  let index = 1;

  while (cursor < end) {
    const next = Math.min(cursor + segmentDuration, end);
    segments.push({
      index,
      start: Number(cursor.toFixed(1)),
      end: Number(next.toFixed(1))
    });
    cursor = next;
    index += 1;
  }

  return segments;
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

function buildFallbackSoraPrompts({
  title = "Projet Sora",
  start = 0,
  end = 30,
  segmentDuration = 10,
  style = "realisme",
  universe = "",
  notes = ""
}) {
  const segments = createSoraSegments(start, end, segmentDuration);

  return segments.map((segment, idx) => {
    const mood =
      idx === 0
        ? "introduction forte"
        : idx === segments.length - 1
        ? "fin marquante"
        : idx >= Math.floor(segments.length / 2)
        ? "montée intense"
        : "progression visuelle";

    const prompt = `Prompt ${segment.index} - de ${formatSeconds(segment.start)} à ${formatSeconds(segment.end)}
Scène ${style}, ${mood}, univers ${universe || "libre"}, continuité visuelle avec le segment précédent, détails crédibles, mouvements de caméra cohérents, intensité adaptée à la musique. ${notes ? `Contraintes : ${notes}` : ""}`.trim();

    return {
      index: segment.index,
      start: segment.start,
      end: segment.end,
      resume: `${title} - segment ${segment.index}`,
      prompt
    };
  });
}

function mapVoice(voiceGender) {
  return voiceGender === "female" ? "nova" : "onyx";
}

/* =========================
   Routes
========================= */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Backend opérationnel",
    model: OPENAI_TEXT_MODEL,
    ttsModel: OPENAI_TTS_MODEL
  });
});

app.post("/api/admin/login", (req, res) => {
  const password = safeText(req.body?.password);

  if (!password) {
    return res.status(400).json({
      ok: false,
      error: "Mot de passe manquant"
    });
  }

  res.json({
    ok: password === ADMIN_PASSWORD
  });
});

app.post("/api/meta/generate", async (req, res) => {
  if (!ensureOpenAI(res)) return;

  try {
    const {
      projectType = "music",
      title = "Mon projet",
      style = "cinematique",
      mode = "video",
      tone = "normal",
      voice = "male",
      notes = ""
    } = req.body || {};

    const payload = {
      projectType,
      title,
      style,
      mode,
      tone,
      voice,
      notes
    };

    const prompt = `
Tu es un assistant français spécialisé en métadonnées courtes pour réseaux sociaux.

Réponds UNIQUEMENT en JSON valide.
Format exact :
{
  "general": "titre + description + hashtags en un seul bloc",
  "shorts": "titre + description + hashtags en un seul bloc, ultra court, 99 caractères max"
}

Règles :
- Pas les mots "Titre", "Description" ou "Hashtags".
- Le champ "general" doit être lisible, naturel, accrocheur.
- Le champ "shorts" doit absolument rester à 99 caractères max.
- Réponse uniquement en français.
- Pas de texte hors JSON.

Données projet :
${JSON.stringify(payload, null, 2)}
`.trim();

    const response = await client.responses.create({
      model: OPENAI_TEXT_MODEL,
      input: prompt
    });

    const outputText = safeText(response.output_text);
    const parsed = extractJsonObject(outputText);

    if (!parsed?.general || !parsed?.shorts) {
      const fallback = buildFallbackMeta(payload);
      return res.json({
        ok: true,
        general: fallback.general,
        shorts: fallback.shorts,
        source: "fallback"
      });
    }

    return res.json({
      ok: true,
      general: safeText(parsed.general),
      shorts: safeText(parsed.shorts).slice(0, 99),
      source: "openai"
    });
  } catch (error) {
    console.error("Erreur /api/meta/generate :", error);
    const fallback = buildFallbackMeta(req.body || {});
    return res.json({
      ok: true,
      general: fallback.general,
      shorts: fallback.shorts,
      source: "fallback-error"
    });
  }
});

app.post("/api/sora/prompts", async (req, res) => {
  if (!ensureOpenAI(res)) return;

  try {
    const {
      title = "Projet Sora",
      start = 0,
      end = 30,
      segmentDuration = 10,
      style = "realisme",
      universe = "",
      notes = "",
      lyricsExcerpt = ""
    } = req.body || {};

    const safeStart = Math.max(0, Number(start) || 0);
    const safeEnd = Math.max(safeStart, Number(end) || 0);
    const safeSegmentDuration = [10, 15].includes(Number(segmentDuration))
      ? Number(segmentDuration)
      : 10;

    const segments = createSoraSegments(safeStart, safeEnd, safeSegmentDuration);

    const prompt = `
Tu es un assistant expert en prompts vidéo pour Sora 2.

Ta mission :
- générer une série cohérente de prompts
- 1 prompt par segment
- respecter exactement les temps donnés
- écrire en français
- rester visuel, clair et exploitable

Réponds UNIQUEMENT en JSON valide.
Format exact :
{
  "prompts": [
    {
      "index": 1,
      "start": 0,
      "end": 10,
      "resume": "résumé court",
      "prompt": "prompt complet prêt à coller"
    }
  ]
}

Règles :
- un objet par segment
- les champs start et end doivent correspondre aux segments donnés
- le prompt doit être cohérent avec la musique
- pas de texte hors JSON
- pas de résolution, pas de fps

Données projet :
${JSON.stringify(
  {
    title,
    style,
    universe,
    notes,
    lyricsExcerpt,
    segments
  },
  null,
  2
)}
`.trim();

    const response = await client.responses.create({
      model: OPENAI_TEXT_MODEL,
      input: prompt
    });

    const outputText = safeText(response.output_text);
    const parsed = extractJsonObject(outputText);

    if (!parsed?.prompts || !Array.isArray(parsed.prompts) || !parsed.prompts.length) {
      return res.json({
        ok: true,
        prompts: buildFallbackSoraPrompts({
          title,
          start: safeStart,
          end: safeEnd,
          segmentDuration: safeSegmentDuration,
          style,
          universe,
          notes
        }),
        source: "fallback"
      });
    }

    const normalized = parsed.prompts.map((item, index) => ({
      index: Number(item.index) || index + 1,
      start: Number(item.start),
      end: Number(item.end),
      resume: safeText(item.resume) || `${title} - segment ${index + 1}`,
      prompt: safeText(item.prompt)
    }));

    return res.json({
      ok: true,
      prompts: normalized,
      source: "openai"
    });
  } catch (error) {
    console.error("Erreur /api/sora/prompts :", error);

    const fallbackPrompts = buildFallbackSoraPrompts({
      title: req.body?.title,
      start: req.body?.start,
      end: req.body?.end,
      segmentDuration: req.body?.segmentDuration,
      style: req.body?.style,
      universe: req.body?.universe,
      notes: req.body?.notes
    });

    return res.json({
      ok: true,
      prompts: fallbackPrompts,
      source: "fallback-error"
    });
  }
});

app.post("/api/speech/generate", async (req, res) => {
  if (!ensureOpenAI(res)) return;

  try {
    const {
      text = "",
      voiceGender = "male",
      tone = "normal",
      speed = "normal"
    } = req.body || {};

    const cleanText = safeText(text);

    if (!cleanText) {
      return res.status(400).json({
        ok: false,
        error: "Texte manquant"
      });
    }

    if (cleanText.length > 1500) {
      return res.status(400).json({
        ok: false,
        error: "Texte trop long pour cette V1. Reste sous 1500 caractères."
      });
    }

    const voice = mapVoice(voiceGender);

    const instructions = `
Parle uniquement en français.
Ton demandé : ${tone}.
Vitesse perçue : ${speed}.
Style global : voix claire, propre, naturelle, exploitable pour une vidéo courte.
`.trim();

    const speech = await client.audio.speech.create({
      model: OPENAI_TTS_MODEL,
      voice,
      input: cleanText,
      instructions
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", "inline; filename=speech.mp3");
    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur /api/speech/generate :", error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de générer la voix"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
