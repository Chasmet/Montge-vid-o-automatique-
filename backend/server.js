import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const VOICE_STYLE_CONFIG = {
  "masculin-naturel": {
    voice: "onyx",
    label: "masculin naturel",
    direction: "voix masculine naturelle, claire, posée, moderne"
  },
  "feminin-naturel": {
    voice: "nova",
    label: "féminin naturel",
    direction: "voix féminine naturelle, fluide, claire, moderne"
  },
  "masculin-mature": {
    voice: "onyx",
    label: "masculin mature",
    direction: "voix masculine mature, rassurante, stable, narrative"
  },
  "feminin-mature": {
    voice: "shimmer",
    label: "féminin mature",
    direction: "voix féminine mature, stable, élégante, narrative"
  },
  "masculin-emotion": {
    voice: "onyx",
    label: "masculin émotion",
    direction: "voix masculine chargée d’émotion, sincère, sensible"
  },
  "feminin-emotion": {
    voice: "shimmer",
    label: "féminin émotion",
    direction: "voix féminine émotionnelle, sensible, expressive"
  },
  "voix-douce": {
    voice: "nova",
    label: "voix douce",
    direction: "voix douce, tendre, apaisante, enveloppante"
  },
  "voix-sombre": {
    voice: "onyx",
    label: "voix sombre",
    direction: "voix sombre, grave, mystérieuse, intense"
  },
  "masculin-energetique": {
    voice: "alloy",
    label: "masculin énergique",
    direction: "voix masculine énergique, nerveuse, dynamique, impactante"
  },
  "feminin-dynamique": {
    voice: "nova",
    label: "féminin dynamique",
    direction: "voix féminine dynamique, vive, claire, entraînante"
  },
  "voix-punchy": {
    voice: "alloy",
    label: "voix punchy",
    direction: "voix percutante, punchy, directe, taillée pour les réseaux"
  },
  "voix-annonce": {
    voice: "shimmer",
    label: "voix annonce",
    direction: "voix annonceuse, propre, rythmée, professionnelle"
  },
  "voix-robot": {
    voice: "alloy",
    label: "voix robot",
    direction: "voix robotique légère, artificielle mais intelligible"
  },
  "voix-ia-futuriste": {
    voice: "alloy",
    label: "voix IA futuriste",
    direction: "voix futuriste, nette, froide, technologique"
  },
  "voix-mysterieuse": {
    voice: "shimmer",
    label: "voix mystérieuse",
    direction: "voix mystérieuse, subtile, intrigante, cinématique"
  },
  "voix-froide": {
    voice: "onyx",
    label: "voix froide",
    direction: "voix froide, distante, contrôlée, minimaliste"
  }
};

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

function makeHashtags(tags) {
  return tags
    .map((tag) => tag.replace(/[^a-zA-Z0-9àâäéèêëïîôöùûüç]/gi, ""))
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.toLowerCase()}`))
    .slice(0, 5);
}

function buildMetaBlock(title, description, hashtags) {
  return `${title}\n${description}\n${hashtags.join(" ")}`.trim();
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

function formatSeconds(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return `${safe.toFixed(1).replace(".0", "")} s`;
  const m = Math.floor(safe / 60);
  const s = Math.round(safe % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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

function resolveVoiceConfig(voiceStyle, voiceFamily) {
  if (VOICE_STYLE_CONFIG[voiceStyle]) {
    return VOICE_STYLE_CONFIG[voiceStyle];
  }

  if (voiceFamily === "emotion") {
    return VOICE_STYLE_CONFIG["feminin-emotion"];
  }

  if (voiceFamily === "dynamique") {
    return VOICE_STYLE_CONFIG["voix-punchy"];
  }

  if (voiceFamily === "special") {
    return VOICE_STYLE_CONFIG["voix-robot"];
  }

  return VOICE_STYLE_CONFIG["masculin-naturel"];
}

function buildFallbackMeta({
  projectType = "speech",
  title = "Mon projet",
  style = "normal",
  mode = "video",
  tone = "normal",
  voiceStyle = "masculin-naturel"
}) {
  const styleLabel = VOICE_STYLE_CONFIG[voiceStyle]?.label || voiceStyle;
  const cleanTitle = safeText(title) || "Mon projet";

  const hashtags = makeHashtags([
    projectType,
    style,
    mode,
    tone,
    styleLabel.replace(/\s+/g, ""),
    "montageia"
  ]);

  const general = buildMetaBlock(
    cleanTitle,
    `Contenu ${projectType === "speech" ? "narratif" : "musical"}, style ${style}, mode ${mode}, voix ${styleLabel}.`,
    hashtags
  );

  const shorts = buildMetaBlock(
    cleanTitle,
    styleLabel,
    hashtags.slice(0, 2)
  ).slice(0, 99);

  return { general, shorts };
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
Séquence ${style}, ${mood}, continuité visuelle avec le segment précédent, rendu pensé pour Sora 2. ${universe ? `Univers : ${universe}.` : ""} ${notes ? `Contraintes : ${notes}.` : ""}`.trim();

    return {
      index: segment.index,
      start: segment.start,
      end: segment.end,
      resume: `${title} - segment ${segment.index}`,
      prompt
    };
  });
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

  return res.json({
    ok: password === ADMIN_PASSWORD
  });
});

app.post("/api/meta/generate", async (req, res) => {
  if (!ensureOpenAI(res)) return;

  try {
    const {
      projectType = "speech",
      title = "Mon projet",
      style = "normal",
      mode = "video",
      tone = "normal",
      voiceFamily = "naturel",
      voiceStyle = "masculin-naturel",
      notes = ""
    } = req.body || {};

    const prompt = `
Tu es un assistant expert en métadonnées sociales en français.

Réponds UNIQUEMENT en JSON valide.
Format exact :
{
  "general": "bloc prêt à copier",
  "shorts": "bloc prêt à copier, 99 caractères max"
}

Règles obligatoires :
- Le champ "general" doit contenir 3 lignes :
  1. titre
  2. description
  3. hashtags
- Le champ "shorts" doit contenir aussi un seul bloc prêt à copier
- Ne jamais écrire les mots : Titre, Description, Hashtags
- Maximum 5 hashtags
- Réponse uniquement en français
- Pas de markdown
- Pas de texte hors JSON

Données projet :
${JSON.stringify(
  {
    projectType,
    title,
    style,
    mode,
    tone,
    voiceFamily,
    voiceStyle,
    notes
  },
  null,
  2
)}
`.trim();

    const response = await client.responses.create({
      model: OPENAI_TEXT_MODEL,
      input: prompt
    });

    const parsed = extractJsonObject(safeText(response.output_text));

    if (!parsed?.general || !parsed?.shorts) {
      const fallback = buildFallbackMeta(req.body || {});
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
- Un objet par segment
- Respecte exactement les temps donnés
- Réponse en français
- Prompt visuel, exploitable, cohérent
- Pas de résolution, pas de fps
- Pas de texte hors JSON

Données :
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

    const parsed = extractJsonObject(safeText(response.output_text));

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

    return res.json({
      ok: true,
      prompts: buildFallbackSoraPrompts(req.body || {}),
      source: "fallback-error"
    });
  }
});

app.post("/api/speech/generate", async (req, res) => {
  if (!ensureOpenAI(res)) return;

  try {
    const {
      text = "",
      voiceFamily = "naturel",
      voiceStyle = "masculin-naturel",
      tone = "normal",
      speed = "1"
    } = req.body || {};

    const cleanText = safeText(text);

    if (!cleanText) {
      return res.status(400).json({
        ok: false,
        error: "Texte manquant"
      });
    }

    if (cleanText.length > 2000) {
      return res.status(400).json({
        ok: false,
        error: "Texte trop long pour cette V1. Reste sous 2000 caractères."
      });
    }

    const voiceConfig = resolveVoiceConfig(voiceStyle, voiceFamily);

    const instructions = `
Parle uniquement en français.
Style vocal demandé : ${voiceConfig.direction}.
Ton demandé : ${tone}.
Vitesse perçue : ${speed}.
Le rendu doit rester naturel, propre et exploitable pour une vidéo courte.
`.trim();

    const speech = await client.audio.speech.create({
      model: OPENAI_TTS_MODEL,
      voice: voiceConfig.voice,
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
