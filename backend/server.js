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
const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  process.env.OPENAI_TEXT_MODEL ||
  "gpt-4.1-mini";

const TTS_MODEL =
  process.env.TTS_MODEL ||
  process.env.OPENAI_TTS_MODEL ||
  "gpt-4o-mini-tts";

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-mobile");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 300 * 1024 * 1024,
    files: 80
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

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function removePathQuietly(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {}
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugTag(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
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
    analysis?.summary ||
      clipIdeas?.creativeDirection ||
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

function buildLocalMontagePlan({
  candidates = [],
  durationSec = 30,
  transitionStyle = "fade",
  effectStyle = ""
}) {
  const cleanCandidates = Array.isArray(candidates)
    ? candidates.filter((item) => item && item.id)
    : [];

  const selectedMediaIds = cleanCandidates.map((item) => item.id);

  const computedEffectStyle =
    safeText(effectStyle) ||
    (cleanCandidates.every((item) => item.mediaType === "image")
      ? "zoom"
      : "clean");

  if (!selectedMediaIds.length) {
    return {
      transitionStyle,
      effectStyle: computedEffectStyle,
      selectedMediaIds: [],
      timeline: []
    };
  }

  const totalDuration = Math.max(0.1, Number(durationSec || 30));
  const partDuration = totalDuration / selectedMediaIds.length;

  let cursor = 0;
  const timeline = selectedMediaIds.map((mediaId, index) => {
    const start = Number(cursor.toFixed(3));
    const end =
      index === selectedMediaIds.length - 1
        ? Number(totalDuration.toFixed(3))
        : Number((cursor + partDuration).toFixed(3));

    cursor = end;

    return {
      mediaId,
      start,
      end,
      transition: transitionStyle,
      effect: computedEffectStyle
    };
  });

  return {
    transitionStyle,
    effectStyle: computedEffectStyle,
    selectedMediaIds,
    timeline
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
  lyricsExcerpt = ""
}) {
  const prompts = [];
  let cursor = Number(start || 0);
  let index = 1;

  const cleanTitle = safeText(title) || "Projet vidéo";
  const cleanStyle = safeText(style) || "realisme";
  const cleanUniverse = safeText(universe);
  const cleanNotes = safeText(notes);
  const cleanLyrics = safeText(lyricsExcerpt);

  while (cursor < end) {
    const next = Math.min(end, cursor + segmentDuration);

    const pieces = [
      `Scène ${index} pour "${cleanTitle}"`,
      `style ${cleanStyle}`,
      "rendu cinématographique cohérent",
      "continuité visuelle avec la scène précédente",
      cleanUniverse ? `univers : ${cleanUniverse}` : "",
      cleanNotes ? `notes : ${cleanNotes}` : "",
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
      instructions: "Voix masculine énergique, punchy, vivante."
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
      stderrTail = next.length > 6000 ? next.slice(-6000) : next;
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

function buildImageFilter(aspectRatio, effectStyle, durationSec, transitionStyle) {
  const { width, height } = aspectConfig(aspectRatio);
  const d = Math.max(1, Math.round(durationSec * 24));

  let effect = "";

  if (effectStyle === "zoom") {
    effect = `zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:s=${width}x${height}:fps=24`;
  } else if (effectStyle === "pan") {
    effect = `zoompan=z='1.02':x='if(lte(on,${Math.floor(
      d / 2
    )}),on*0.4,((${d}-on))*0.4)':y='0':d=${d}:s=${width}x${height}:fps=24`;
  } else {
    effect = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  }

  let vf = `${effect},setsar=1,format=yuv420p`;

  if (transitionStyle === "fade" && durationSec > 1) {
    const fadeOutStart = Math.max(0, durationSec - 0.25);
    vf += `,fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOutStart}:d=0.2`;
  }

  return vf;
}

function buildVideoFilter(aspectRatio, transitionStyle, durationSec) {
  let vf = scalePadFilter(aspectRatio);

  if (transitionStyle === "fade" && durationSec > 1) {
    const fadeOutStart = Math.max(0, durationSec - 0.25);
    vf += `,fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOutStart}:d=0.2`;
  }

  return vf;
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

async function createImageSegment(
  inputPath,
  outputPath,
  durationSec,
  aspectRatio,
  transitionStyle,
  effectStyle,
  id,
  label
) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-loop",
    "1",
    "-t",
    String(durationSec),
    "-i",
    inputPath,
    "-vf",
    buildImageFilter(aspectRatio, effectStyle, durationSec, transitionStyle),
    "-r",
    "24",
    "-threads",
    "1",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function createVideoSegment(
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
    "-t",
    String(durationSec),
    "-i",
    inputPath,
    "-vf",
    buildVideoFilter(aspectRatio, transitionStyle, durationSec),
    "-r",
    "24",
    "-threads",
    "1",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function concatMp4ListCopy(filePaths, outputPath, workDir, id, label) {
  const listPath = path.join(
    workDir,
    `${label.replace(/\s+/g, "_")}.txt`
  );

  const content = filePaths
    .map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`)
    .join("\n");

  await fsp.writeFile(listPath, content, "utf8");

  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath
  ];

  await runFfmpeg(args, id, label);
}

async function muxAudioAndVideo(videoPath, audioPath, outputPath, id) {
  const args = [
    ...ffmpegBaseArgs(),
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
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

function buildFallbackTimeline(
  mediaManifest,
  totalDuration,
  transitionStyle,
  effectStyle
) {
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

function splitTimelineIntoChunks(timeline) {
  const chunks = [];
  let current = [];
  let currentDuration = 0;

  for (const item of timeline) {
    const dur = Math.max(0.1, Number((item.end - item.start).toFixed(3)));

    if (currentDuration + dur > 10 && current.length) {
      chunks.push(current);
      current = [];
      currentDuration = 0;
    }

    current.push(item);
    currentDuration += dur;
  }

  if (current.length) chunks.push(current);
  return chunks;
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
      mediaId: item.mediaId,
      start: Number(item.start || 0),
      end: Number(item.end || 0),
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

  if (Math.abs(total - totalDuration) < 0.5) {
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
   Routes
========================= */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Backend principal opérationnel",
    textModelDisabled: true,
    textModelName: OPENAI_MODEL,
    ttsModel: TTS_MODEL,
    ffmpeg: !!ffmpegPath,
    openaiVoiceEnabled: !!client
  });
});

app.post("/api/meta/generate", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const style = safeText(req.body?.style) || "créatif";
    const projectType = safeText(req.body?.projectType) || "media";
    const tone = safeText(req.body?.tone) || "normal";
    const voiceStyle = safeText(req.body?.voiceStyle) || "";
    const mode = safeText(req.body?.mode) || "video";
    const analysis = req.body?.analysis || null;
    const clipIdeas = req.body?.clipIdeas || null;

    log(id, "META LOCAL", `${title} / ${projectType}`);

    const meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone,
      voiceStyle,
      mode,
      analysis,
      clipIdeas
    });

    res.json({
      ok: true,
      general: meta.general,
      shorts: meta.shorts
    });
  } catch (error) {
    console.error(`[${id}] META LOCAL ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de générer les métadonnées."
    });
  }
});

app.post("/api/montage/plan", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet";
    const projectType = safeText(req.body?.projectType) || "music";
    const style = safeText(req.body?.style) || "social";
    const durationSec = Number(req.body?.durationSec || 30);
    const analysis = req.body?.analysis || {};
    const clipIdeas = req.body?.clipIdeas || {};
    const candidates = Array.isArray(req.body?.candidates)
      ? req.body.candidates
      : [];

    if (!candidates.length) {
      return res.status(400).json({
        ok: false,
        error: "Aucun média candidat."
      });
    }

    log(id, "PLAN LOCAL", `${title} / ${candidates.length} médias`);

    const plan = buildLocalMontagePlan({
      candidates,
      durationSec,
      transitionStyle: "fade",
      effectStyle:
        candidates.every((item) => item.mediaType === "image")
          ? "zoom"
          : "clean"
    });

    const meta = buildGeminiBasedMeta({
      title,
      projectType,
      style,
      tone: safeText(analysis?.dominantMood) || style,
      mode: candidates[0]?.mediaType || "video",
      analysis,
      clipIdeas
    });

    res.json({
      ok: true,
      plan,
      general: meta.general,
      shorts: meta.shorts
    });
  } catch (error) {
    console.error(`[${id}] PLAN LOCAL ERROR`, error);
    res.status(500).json({
      ok: false,
      error: "Impossible de créer le plan de montage."
    });
  }
});

app.post("/api/sora/prompts", async (req, res) => {
  const id = req.reqId;

  try {
    const title = safeText(req.body?.title) || "Projet vidéo";
    const start = Number(req.body?.start || 0);
    const end = Number(req.body?.end || 0);
    const segmentDuration = Number(req.body?.segmentDuration || 10);
    const style = safeText(req.body?.style) || "realisme";
    const universe = safeText(req.body?.universe || "");
    const notes = safeText(req.body?.notes || "");
    const lyricsExcerpt = safeText(req.body?.lyricsExcerpt || "");

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
      lyricsExcerpt
    });

    log(id, "SORA LOCAL", `${title} / ${prompts.length}`);

    res.json({
      ok: true,
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

app.post(
  "/api/render/video",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "media", maxCount: 80 }
  ]),
  async (req, res) => {
    const id = req.reqId;
    const workDir = path.join(TMP_ROOT, `render_${Date.now()}_${id}`);

    try {
      await ensureDir(workDir);

      const audioFile = req.files?.audio?.[0] || null;
      const mediaFiles = req.files?.media || [];

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
      const audioStartSec = Number(req.body?.audioStartSec || 0);
      const audioEndSec = Number(req.body?.audioEndSec || 0);
      const requestedDuration = Number(req.body?.targetDurationSec || 0);

      const mediaManifest = parseJsonSafe(req.body?.mediaManifestJson, []) || [];
      const providedTimeline = parseJsonSafe(req.body?.timelineJson, []) || [];

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

      await removePathQuietly(audioFile.path);

      const fileMap = new Map();

      mediaFiles.forEach((file, index) => {
        const manifest = mediaManifest[index];
        if (manifest?.id) {
          fileMap.set(manifest.id, {
            path: file.path,
            originalname: file.originalname,
            mediaType: manifest.mediaType || mode
          });
        }
      });

      const fallbackManifest = mediaManifest.length
        ? mediaManifest
        : mediaFiles.map((file, index) => ({
            id: `media_${index + 1}`,
            fileName: file.originalname,
            mediaType: mode
          }));

      const timeline = normalizeTimeline(
        providedTimeline,
        finalDuration,
        fallbackManifest,
        transitionStyle,
        effectStyle
      );

      if (!timeline.length) {
        throw new Error("Timeline vide.");
      }

      const chunks = splitTimelineIntoChunks(timeline);
      const chunkFiles = [];

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunkTimeline = chunks[chunkIndex];
        const chunkDir = path.join(workDir, `chunk_${chunkIndex + 1}`);
        await ensureDir(chunkDir);

        const segmentFiles = [];

        for (let i = 0; i < chunkTimeline.length; i += 1) {
          const item = chunkTimeline[i];
          const media = fileMap.get(item.mediaId);

          if (!media) {
            log(id, "MEDIA MISSING", `timeline mediaId=${item.mediaId}`);
            continue;
          }

          const segmentDuration = Number((item.end - item.start).toFixed(3));
          if (segmentDuration <= 0) continue;

          const segmentPath = path.join(
            chunkDir,
            `segment_${String(i + 1).padStart(2, "0")}.mp4`
          );

          segmentFiles.push(segmentPath);

          log(
            id,
            "SEGMENT BUILD",
            `chunk=${chunkIndex + 1}/${chunks.length} media=${media.originalname} type=${media.mediaType} dur=${segmentDuration}`
          );

          if ((media.mediaType || mode) === "video") {
            await createVideoSegment(
              media.path,
              segmentPath,
              segmentDuration,
              aspectRatio,
              item.transition || transitionStyle,
              id,
              `video segment ${chunkIndex + 1}-${i + 1}`
            );
          } else {
            await createImageSegment(
              media.path,
              segmentPath,
              segmentDuration,
              aspectRatio,
              item.transition || transitionStyle,
              item.effect || effectStyle,
              id,
              `image segment ${chunkIndex + 1}-${i + 1}`
            );
          }
        }

        if (!segmentFiles.length) {
          await removePathQuietly(chunkDir);
          continue;
        }

        const chunkOut = path.join(
          workDir,
          `chunk_render_${chunkIndex + 1}.mp4`
        );
        chunkFiles.push(chunkOut);

        if (segmentFiles.length === 1) {
          await fsp.copyFile(segmentFiles[0], chunkOut);
        } else {
          await concatMp4ListCopy(
            segmentFiles,
            chunkOut,
            chunkDir,
            id,
            `concat chunk ${chunkIndex + 1}`
          );
        }

        await removePathQuietly(chunkDir);
      }

      if (!chunkFiles.length) {
        throw new Error("Aucun chunk vidéo généré.");
      }

      if (chunkFiles.length === 1) {
        await fsp.copyFile(chunkFiles[0], finalSilentPath);
      } else {
        await concatMp4ListCopy(
          chunkFiles,
          finalSilentPath,
          workDir,
          id,
          "concat final silent"
        );
      }

      await muxAudioAndVideo(
        finalSilentPath,
        trimmedAudioPath,
        finalPath,
        id
      );

      const stat = await fsp.stat(finalPath);
      log(id, "RENDER OK", `${stat.size} bytes`);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${title.replace(/[^\w-]/g, "_")}.mp4"`
      );

      const stream = fs.createReadStream(finalPath);

      stream.on("close", async () => {
        await removePathQuietly(workDir);
      });

      stream.on("error", async (streamError) => {
        console.error(`[${id}] STREAM ERROR`, streamError);
        await removePathQuietly(workDir);
      });

      stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] RENDER ERROR`, error);

      const uploaded = [
        ...(req.files?.audio || []).map((f) => f.path),
        ...(req.files?.media || []).map((f) => f.path)
      ];

      for (const filePath of uploaded) {
        await removePathQuietly(filePath);
      }

      await removePathQuietly(workDir);

      res.status(500).json({
        ok: false,
        error: error.message || "Impossible de créer la vidéo."
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Serveur principal démarré sur le port ${PORT}`);
});
