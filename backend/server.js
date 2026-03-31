import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { execFile } from "child_process";
import { promisify } from "util";

dotenv.config();

const execFileAsync = promisify(execFile);

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

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-renders");
const UPLOAD_ROOT = path.join(os.tmpdir(), "montage-ia-uploads");

fs.mkdirSync(TMP_ROOT, { recursive: true });
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    files: 30,
    fileSize: 120 * 1024 * 1024
  }
});

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

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 0.25), 4.0);
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

function resolveVoiceConfig({ voiceStyle, voiceFamily, voiceGender }) {
  if (voiceStyle && VOICE_STYLE_CONFIG[voiceStyle]) {
    return VOICE_STYLE_CONFIG[voiceStyle];
  }

  if (voiceGender === "female") {
    return VOICE_STYLE_CONFIG["feminin-naturel"];
  }

  if (voiceGender === "male") {
    return VOICE_STYLE_CONFIG["masculin-naturel"];
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

  return {
    general: buildMetaBlock(
      cleanTitle,
      `Contenu ${projectType === "speech" ? "narratif" : "musical"}, style ${style}, mode ${mode}, voix ${styleLabel}.`,
      hashtags
    ),
    shorts: buildMetaBlock(cleanTitle, styleLabel, hashtags.slice(0, 2)).slice(0, 99)
  };
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

async function ffmpegRun(args) {
  await execFileAsync(ffmpegPath, args, {
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024
  });
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobeStatic.path,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath
      ],
      { windowsHide: true }
    );

    const duration = Number((stdout || "").trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 1;
  } catch {
    return 1;
  }
}

async function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch {}
}

async function removeDirQuietly(dirPath) {
  if (!dirPath) return;
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {}
}

async function trimAudio({
  inputPath,
  outputPath,
  startSec,
  durationSec
}) {
  await ffmpegRun([
    "-y",
    "-ss", String(Math.max(0, startSec)),
    "-t", String(Math.max(0.1, durationSec)),
    "-i", inputPath,
    "-vn",
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath
  ]);
}

function baseVideoFilter() {
  return "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p";
}

async function buildImageSegment({
  inputPath,
  outputPath,
  durationSec
}) {
  const frames = Math.max(30, Math.round(durationSec * 30));

  const filter = `scale=1600:900:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=30,setsar=1,format=yuv420p`;

  await ffmpegRun([
    "-y",
    "-loop", "1",
    "-t", String(durationSec),
    "-i", inputPath,
    "-vf", filter,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    outputPath
  ]);
}

async function buildVideoSegment({
  inputPath,
  outputPath,
  durationSec
}) {
  await ffmpegRun([
    "-y",
    "-stream_loop", "-1",
    "-t", String(durationSec),
    "-i", inputPath,
    "-an",
    "-vf", baseVideoFilter(),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    outputPath
  ]);
}

async function concatSegmentsWithAudio({
  segmentPaths,
  audioPath,
  outputPath,
  targetDurationSec
}) {
  const listFile = `${outputPath}.txt`;
  const listContent = segmentPaths
    .map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`)
    .join("\n");

  await fsp.writeFile(listFile, listContent, "utf8");

  try {
    await ffmpegRun([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-t", String(targetDurationSec),
      "-shortest",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath
    ]);
  } finally {
    await removeFileQuietly(listFile);
  }
}

async function renderImageMontage({
  imagePaths,
  audioPath,
  outputPath,
  targetDurationSec,
  workDir
}) {
  const perImage = Math.max(targetDurationSec / Math.max(imagePaths.length, 1), 0.6);
  const segments = [];

  for (let i = 0; i < imagePaths.length; i += 1) {
    const segmentPath = path.join(workDir, `img_seg_${i + 1}.mp4`);
    await buildImageSegment({
      inputPath: imagePaths[i],
      outputPath: segmentPath,
      durationSec: perImage
    });
    segments.push(segmentPath);
  }

  await concatSegmentsWithAudio({
    segmentPaths: segments,
    audioPath,
    outputPath,
    targetDurationSec
  });
}

async function renderVideoMontage({
  videoPaths,
  audioPath,
  outputPath,
  targetDurationSec,
  workDir
}) {
  const perVideo = Math.max(targetDurationSec / Math.max(videoPaths.length, 1), 0.6);
  const segments = [];

  for (let i = 0; i < videoPaths.length; i += 1) {
    const segmentPath = path.join(workDir, `vid_seg_${i + 1}.mp4`);
    await buildVideoSegment({
      inputPath: videoPaths[i],
      outputPath: segmentPath,
      durationSec: perVideo
    });
    segments.push(segmentPath);
  }

  await concatSegmentsWithAudio({
    segmentPaths: segments,
    audioPath,
    outputPath,
    targetDurationSec
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
- Le champ "general" doit contenir 3 lignes
- Le champ "shorts" doit contenir un bloc très court
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
      voiceGender = "",
      voiceFamily = "naturel",
      voiceStyle = "",
      tone = "normal",
      speed = 1
    } = req.body || {};

    const cleanText = safeText(text);

    if (!cleanText) {
      return res.status(400).json({
        ok: false,
        error: "Texte manquant"
      });
    }

    if (cleanText.length > 4096) {
      return res.status(400).json({
        ok: false,
        error: "Texte trop long. Reste sous 4096 caractères."
      });
    }

    const voiceConfig = resolveVoiceConfig({
      voiceStyle,
      voiceFamily,
      voiceGender
    });

    const speech = await client.audio.speech.create({
      model: OPENAI_TTS_MODEL,
      voice: voiceConfig.voice,
      input: cleanText,
      instructions: `
Parle uniquement en français.
Style vocal demandé : ${voiceConfig.direction}.
Ton demandé : ${tone}.
Le rendu doit rester naturel, propre et exploitable pour une vidéo courte.
      `.trim(),
      response_format: "mp3",
      speed: normalizeSpeed(speed)
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

app.post(
  "/api/render/video",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "media", maxCount: 20 }
  ]),
  async (req, res) => {
    let jobDir = null;
    const uploadedFiles = [];

    try {
      const audioFile = req.files?.audio?.[0] || null;
      const mediaFiles = req.files?.media || [];

      if (audioFile?.path) uploadedFiles.push(audioFile.path);
      mediaFiles.forEach((file) => {
        if (file?.path) uploadedFiles.push(file.path);
      });

      if (!audioFile) {
        return res.status(400).json({
          ok: false,
          error: "Audio principal manquant"
        });
      }

      if (!mediaFiles.length) {
        return res.status(400).json({
          ok: false,
          error: "Aucun média envoyé pour le rendu"
        });
      }

      const projectType = safeText(req.body?.projectType) || "speech";
      const mode = safeText(req.body?.mode) || "video";
      const audioStartSec = Math.max(0, normalizeNumber(req.body?.audioStartSec, 0));
      const audioEndSec = Math.max(audioStartSec, normalizeNumber(req.body?.audioEndSec, 0));
      const requestedTargetDuration = Math.max(1, normalizeNumber(req.body?.targetDurationSec, 1));
      const targetDurationSec = audioEndSec > audioStartSec
        ? audioEndSec - audioStartSec
        : requestedTargetDuration;

      jobDir = await fsp.mkdtemp(path.join(TMP_ROOT, "job-"));

      const trimmedAudioPath = path.join(jobDir, "audio_track.m4a");
      const outputPath = path.join(jobDir, "render.mp4");

      await trimAudio({
        inputPath: audioFile.path,
        outputPath: trimmedAudioPath,
        startSec: audioStartSec,
        durationSec: targetDurationSec
      });

      const mediaPaths = mediaFiles.map((file) => file.path);

      if (mode === "image") {
        await renderImageMontage({
          imagePaths: mediaPaths,
          audioPath: trimmedAudioPath,
          outputPath,
          targetDurationSec,
          workDir: jobDir
        });
      } else {
        await renderVideoMontage({
          videoPaths: mediaPaths,
          audioPath: trimmedAudioPath,
          outputPath,
          targetDurationSec,
          workDir: jobDir
        });
      }

      const videoBuffer = await fsp.readFile(outputPath);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${projectType}_render.mp4"`
      );

      return res.send(videoBuffer);
    } catch (error) {
      console.error("Erreur /api/render/video :", error);
      return res.status(500).json({
        ok: false,
        error: "Impossible de créer le montage vidéo"
      });
    } finally {
      for (const filePath of uploadedFiles) {
        await removeFileQuietly(filePath);
      }
      await removeDirQuietly(jobDir);
    }
  }
);

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
