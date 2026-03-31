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

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-mobile");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 60
  }
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* =========================
   Logs
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
  if (extra) {
    console.log(`[${id}] ${message} ${extra}`);
  } else {
    console.log(`[${id}] ${message}`);
  }
}

function safeText(value) {
  return (value || "").toString().trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function extractTextFromOpenAIResponse(response) {
  if (!response) return "";

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonFromText(text) {
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

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  return null;
}

function pickVoice(voiceFamily, voiceStyle, tone) {
  const key = `${voiceFamily}|${voiceStyle}|${tone}`;

  const map = {
    "naturel|masculin-naturel|normal": { voice: "alloy", instructions: "Voix masculine naturelle, claire, posée." },
    "naturel|feminin-naturel|normal": { voice: "nova", instructions: "Voix féminine naturelle, douce, claire." },
    "naturel|masculin-mature|normal": { voice: "onyx", instructions: "Voix masculine mature, grave, rassurante." },
    "naturel|feminin-mature|normal": { voice: "shimmer", instructions: "Voix féminine mature, posée, élégante." },

    "emotion|masculin-emotion|emotion": { voice: "ash", instructions: "Voix masculine émotionnelle, sincère, touchante." },
    "emotion|feminin-emotion|emotion": { voice: "coral", instructions: "Voix féminine émotionnelle, sensible, vibrante." },
    "emotion|voix-douce|calm": { voice: "shimmer", instructions: "Voix douce, calme, enveloppante." },
    "emotion|voix-sombre|emotion": { voice: "onyx", instructions: "Voix sombre, intense, dramatique." },

    "dynamique|masculin-energetique|energetic": { voice: "echo", instructions: "Voix masculine énergique, punchy, vivante." },
    "dynamique|feminin-dynamique|energetic": { voice: "ballad", instructions: "Voix féminine dynamique, assurée, vive." },
    "dynamique|voix-punchy|energetic": { voice: "echo", instructions: "Voix percutante, directe, rythmée." },
    "dynamique|voix-annonce|normal": { voice: "sage", instructions: "Voix annonce, claire, puissante, propre." },

    "special|voix-robot|normal": { voice: "verse", instructions: "Voix robotisée légère, précise, futuriste." },
    "special|voix-ia-futuriste|normal": { voice: "verse", instructions: "Voix IA futuriste, propre, stylisée." },
    "special|voix-mysterieuse|emotion": { voice: "fable", instructions: "Voix mystérieuse, cinématographique, intrigante." },
    "special|voix-froide|calm": { voice: "sage", instructions: "Voix froide, distante, maîtrisée." }
  };

  if (map[key]) return map[key];

  if (tone === "energetic") {
    return { voice: "echo", instructions: "Voix énergique, claire, rythmée." };
  }

  if (tone === "emotion") {
    return { voice: "coral", instructions: "Voix émotionnelle, sincère, expressive." };
  }

  if (tone === "calm") {
    return { voice: "shimmer", instructions: "Voix calme, douce, posée." };
  }

  return { voice: "alloy", instructions: "Voix naturelle, claire, agréable." };
}

async function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    log(id, `FFMPEG START`, label);
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        log(id, `FFMPEG OK`, label);
        resolve({ stdout, stderr });
      } else {
        log(id, `FFMPEG ERROR`, `${label} code=${code}`);
        console.error(stderr);
        reject(new Error(`FFmpeg a échoué: ${label}`));
      }
    });

    child.on("error", (error) => {
      log(id, `FFMPEG SPAWN ERROR`, `${label} ${error.message}`);
      reject(error);
    });
  });
}

function segmentDuration(totalSeconds, totalItems, index) {
  const remaining = totalSeconds;
  const base = totalSeconds / totalItems;
  if (index === totalItems - 1) {
    const done = base * index;
    return Math.max(0.1, remaining - done);
  }
  return Math.max(0.1, base);
}

async function createImageSegment(inputPath, outputPath, durationSec, id, label) {
  const vf =
    "scale=1280:720:force_original_aspect_ratio=decrease," +
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2," +
    "format=yuv420p";

  const args = [
    "-y",
    "-loop", "1",
    "-t", String(durationSec),
    "-i", inputPath,
    "-vf", vf,
    "-r", "30",
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function createVideoSegment(inputPath, outputPath, durationSec, id, label) {
  const vf =
    "scale=1280:720:force_original_aspect_ratio=decrease," +
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2," +
    "format=yuv420p";

  const args = [
    "-y",
    "-stream_loop", "-1",
    "-t", String(durationSec),
    "-i", inputPath,
    "-vf", vf,
    "-r", "30",
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function concatSegments(segmentPaths, outputPath, id) {
  const listPath = path.join(path.dirname(outputPath), "concat.txt");
  const content = segmentPaths
    .map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`)
    .join("\n");

  await fsp.writeFile(listPath, content, "utf8");

  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-an",
    outputPath
  ];

  await runFfmpeg(args, id, "concat segments");
}

async function trimAudio(inputPath, outputPath, startSec, endSec, id) {
  const args = [
    "-y",
    "-ss", String(startSec),
    "-to", String(endSec),
    "-i", inputPath,
    "-ar", "44100",
    "-ac", "2",
    "-c:a", "aac",
    outputPath
  ];

  await runFfmpeg(args, id, "trim audio");
}

async function muxAudioAndVideo(videoPath, audioPath, outputPath, id) {
  const args = [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    outputPath
  ];

  await runFfmpeg(args, id, "mux final");
}

/* =========================
   Health
========================= */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend montage opérationnel",
    model: OPENAI_MODEL,
    ttsModel: TTS_MODEL
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

    log(id, "META START", `${title} / ${projectType}`);

    if (!client) {
      const general = `${title}\nCréation ${projectType} ${style} prête à poster.\n#${projectType} #${style} #mobile #video #creation`;
      const shorts = `${title}\n#${projectType} #${style}`.slice(0, 100);
      return res.json({ ok: true, general, shorts });
    }

    const prompt = `
Tu écris des métadonnées prêtes à copier.

Règles strictes :
- Réponds en JSON valide
- Français uniquement
- Pas de markdown
- Pas d'explication
- "general" = un seul bloc prêt à copier, sans écrire "Titre", "Description" ou "Hashtags"
- "shorts" = un seul bloc YouTube Shorts, plus court
- maximum 5 hashtags
- texte naturel, propre, efficace

Format exact :
{
  "general": "",
  "shorts": ""
}

Données :
- titre : ${title}
- type : ${projectType}
- style : ${style}
- ton : ${tone}
- voix : ${voiceStyle}
- mode : ${mode}
`.trim();

    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt
    });

    const text = extractTextFromOpenAIResponse(response);
    const parsed = parseJsonFromText(text);

    if (!parsed?.general || !parsed?.shorts) {
      throw new Error("Réponse méta invalide");
    }

    log(id, "META OK");
    return res.json({
      ok: true,
      general: safeText(parsed.general),
      shorts: safeText(parsed.shorts).slice(0, 100)
    });
  } catch (error) {
    console.error(`[${id}] META ERROR`, error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de générer les métadonnées."
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
    const start = Number(req.body?.start || 0);
    const end = Number(req.body?.end || 0);
    const segmentDuration = Number(req.body?.segmentDuration || 10);
    const style = safeText(req.body?.style) || "realisme";
    const universe = safeText(req.body?.universe) || "";
    const notes = safeText(req.body?.notes) || "";
    const lyricsExcerpt = safeText(req.body?.lyricsExcerpt) || "";

    const total = Math.max(0, end - start);
    if (!total || total <= 0) {
      return res.status(400).json({ ok: false, error: "Durée invalide." });
    }

    const segments = [];
    let cursor = start;
    let index = 1;
    while (cursor < end) {
      const next = Math.min(end, cursor + segmentDuration);
      segments.push({ index, start: cursor, end: next });
      cursor = next;
      index += 1;
    }

    log(id, "SORA START", `${title} / ${segments.length} prompts`);

    if (!client) {
      const prompts = segments.map((segment) => ({
        index: segment.index,
        start: segment.start,
        end: segment.end,
        prompt: `Scène ${segment.index} de ${title}, style ${style}, ambiance cohérente, narration continue, plan cinématographique, décor détaillé, mouvement fluide, intensité visuelle progressive.`
      }));
      return res.json({ ok: true, prompts });
    }

    const prompt = `
Tu crées une série de prompts vidéo pour un générateur de clips.

Règles :
- Réponds en JSON valide
- Français uniquement
- Pas de markdown
- Le tableau doit contenir exactement ${segments.length} entrées
- Chaque prompt doit rester cohérent avec le précédent
- Le style doit être ${style}
- Le résultat doit être exploitable directement

Format exact :
[
  {
    "index": 1,
    "start": 0,
    "end": 10,
    "prompt": ""
  }
]

Titre : ${title}
Style : ${style}
Univers : ${universe || "libre"}
Notes : ${notes || "aucune"}
Extrait : ${lyricsExcerpt || "aucun"}

Segments :
${JSON.stringify(segments, null, 2)}
`.trim();

    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt
    });

    const text = extractTextFromOpenAIResponse(response);
    const parsed = parseJsonFromText(text);

    if (!Array.isArray(parsed)) {
      throw new Error("Réponse prompts invalide");
    }

    const prompts = parsed.map((item, idx) => ({
      index: Number(item.index || idx + 1),
      start: Number(item.start ?? segments[idx]?.start ?? 0),
      end: Number(item.end ?? segments[idx]?.end ?? 0),
      prompt: safeText(item.prompt || "")
    }));

    log(id, "SORA OK");
    return res.json({ ok: true, prompts });
  } catch (error) {
    console.error(`[${id}] SORA ERROR`, error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de générer les prompts vidéo."
    });
  }
});

/* =========================
   Speech
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

    log(id, "SPEECH OK", `${buffer.length} bytes`);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(buffer);
  } catch (error) {
    console.error(`[${id}] SPEECH ERROR`, error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de générer la voix."
    });
  }
});

/* =========================
   Render video
========================= */
app.post(
  "/api/render/video",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "media", maxCount: 50 }
  ]),
  async (req, res) => {
    const id = req.reqId;
    const workDir = path.join(TMP_ROOT, `render_${Date.now()}_${id}`);

    try {
      await ensureDir(workDir);

      const audioFile = req.files?.audio?.[0] || null;
      const mediaFiles = req.files?.media || [];

      const title = safeText(req.body?.title) || "render";
      const projectType = safeText(req.body?.projectType) || "music";
      const mode = safeText(req.body?.mode) || "image";
      const audioStartSec = Number(req.body?.audioStartSec || 0);
      const audioEndSec = Number(req.body?.audioEndSec || 0);
      const requestedDuration = Number(req.body?.targetDurationSec || 0);

      log(id, "RENDER START", `${title} / ${projectType} / ${mode}`);
      log(id, "RENDER FILES", `audio=${audioFile ? 1 : 0} media=${mediaFiles.length}`);
      log(id, "RENDER TIMES", `start=${audioStartSec} end=${audioEndSec} requested=${requestedDuration}`);

      if (!audioFile) {
        return res.status(400).json({ ok: false, error: "Audio principal manquant." });
      }

      if (!mediaFiles.length) {
        return res.status(400).json({ ok: false, error: "Aucun média reçu." });
      }

      const selectedDuration = Math.max(0, audioEndSec - audioStartSec);
      const finalDuration = requestedDuration > 0
        ? Math.min(requestedDuration, selectedDuration || requestedDuration)
        : selectedDuration;

      if (!finalDuration || finalDuration <= 0) {
        return res.status(400).json({ ok: false, error: "Durée finale invalide." });
      }

      log(id, "RENDER FINAL DURATION", `${finalDuration}s`);

      const trimmedAudioPath = path.join(workDir, "audio_trimmed.m4a");
      const silentVideoPath = path.join(workDir, "video_silent.mp4");
      const finalVideoPath = path.join(workDir, "final.mp4");

      await trimAudio(audioFile.path, trimmedAudioPath, audioStartSec, audioEndSec, id);

      const segmentPaths = [];
      const count = mediaFiles.length;

      for (let i = 0; i < count; i += 1) {
        const media = mediaFiles[i];
        const dur = segmentDuration(finalDuration, count, i);
        const out = path.join(workDir, `segment_${String(i + 1).padStart(2, "0")}.mp4`);
        segmentPaths.push(out);

        log(id, "SEGMENT BUILD", `index=${i + 1}/${count} dur=${dur}s file=${media.originalname}`);

        if (mode === "video") {
          await createVideoSegment(media.path, out, dur, id, `segment video ${i + 1}`);
        } else {
          await createImageSegment(media.path, out, dur, id, `segment image ${i + 1}`);
        }
      }

      await concatSegments(segmentPaths, silentVideoPath, id);
      await muxAudioAndVideo(silentVideoPath, trimmedAudioPath, finalVideoPath, id);

      const stat = await fsp.stat(finalVideoPath);
      log(id, "RENDER OK", `${stat.size} bytes`);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `inline; filename="${title.replace(/[^\w-]/g, "_")}.mp4"`);

      const stream = fs.createReadStream(finalVideoPath);
      stream.on("close", async () => {
        log(id, "RENDER CLEANUP");
        await sleep(500);
        await removePathQuietly(workDir);
      });

      return stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] RENDER ERROR`, error);
      await removePathQuietly(workDir);
      return res.status(500).json({
        ok: false,
        error: error.message || "Impossible de créer la vidéo."
      });
    }
  }
);

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
