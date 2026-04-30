import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-subtitles");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const subtitleUpload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 260 * 1024 * 1024,
    files: 8
  }
});

function reqId() {
  return Math.random().toString(36).slice(2, 8);
}

function log(id, msg, extra = "") {
  console.log(`[${id}] ${msg}${extra ? ` ${extra}` : ""}`);
}

function safeText(value) {
  return (value || "").toString().trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function removePathQuietly(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {}
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    log(id, "FFMPEG START", label);

    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });

    child.on("close", (code) => {
      if (code === 0) {
        log(id, "FFMPEG OK", label);
        resolve();
      } else {
        reject(new Error(`FFmpeg ${label} a échoué.${stderr ? ` ${stderr}` : ""}`));
      }
    });

    child.on("error", reject);
  });
}

async function prepareAudioForTranscription(inputPath, workDir, id, startSec, endSec) {
  const outputPath = path.join(workDir, "transcription_audio.mp3");
  const args = ["-y"];

  if (endSec > startSec) {
    args.push("-ss", String(startSec), "-t", String(endSec - startSec));
  }

  args.push(
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-b:a",
    "48k",
    outputPath
  );

  await runFfmpeg(args, id, "prepare transcription audio");
  return outputPath;
}

function srtTimeToAss(value) {
  const clean = safeText(value).replace(",", ".");
  const match = clean.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return "0:00:00.00";

  const h = Number(match[1] || 0);
  const m = String(Number(match[2] || 0)).padStart(2, "0");
  const s = String(Number(match[3] || 0)).padStart(2, "0");
  const cs = String(Math.round(Number(`0.${match[4] || "0"}`) * 100)).padStart(2, "0");

  return `${h}:${m}:${s}.${cs}`;
}

function normalizeSubtitleText(text) {
  return safeText(text)
    .replace(/\\N/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapSubtitleText(text, aspectRatio = "vertical", styleName = "rap") {
  const clean = normalizeSubtitleText(text);
  if (!clean) return "";

  const vertical = aspectRatio !== "horizontal";
  const maxChars = vertical ? (styleName === "tiktok" ? 22 : 26) : 42;
  const maxLines = 2;
  const words = clean.split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);

  const usedWordCount = lines.join(" ").split(" ").filter(Boolean).length;
  if (usedWordCount < words.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[,.!?;:]$/, "")}…`;
  }

  return lines.join("\\N");
}

function parseSrt(srt) {
  const blocks = safeText(srt)
    .replace(/\r/g, "")
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim());
    const text = lines.slice(timeIndex + 1).join(" ").replace(/\{[^}]*\}/g, "");

    if (!text) continue;

    cues.push({
      start: srtTimeToAss(startRaw),
      end: srtTimeToAss(endRaw),
      text
    });
  }

  return cues;
}

function escapeAssText(text) {
  return safeText(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "")
    .replace(/\}/g, "");
}

function subtitleStyle(styleName, aspectRatio) {
  const vertical = aspectRatio !== "horizontal";

  const styles = {
    classic: {
      fontSize: vertical ? 38 : 32,
      primary: "&H00FFFFFF",
      outline: 3,
      shadow: 1,
      marginV: vertical ? 120 : 56,
      bold: -1
    },
    tiktok: {
      fontSize: vertical ? 42 : 36,
      primary: "&H0000FFFF",
      outline: 4,
      shadow: 2,
      marginV: vertical ? 145 : 70,
      bold: -1
    },
    cinema: {
      fontSize: vertical ? 34 : 30,
      primary: "&H00F4F4F4",
      outline: 2,
      shadow: 1,
      marginV: vertical ? 105 : 48,
      bold: 0
    },
    rap: {
      fontSize: vertical ? 40 : 34,
      primary: "&H00FFFFFF",
      outline: 4,
      shadow: 2,
      marginV: vertical ? 125 : 62,
      bold: -1
    }
  };

  return styles[styleName] || styles.rap;
}

function buildAssFromSrt(srt, styleName = "rap", aspectRatio = "vertical") {
  const cues = parseSrt(srt);
  const st = subtitleStyle(styleName, aspectRatio);
  const playResX = aspectRatio === "horizontal" ? 1280 : 720;
  const playResY = aspectRatio === "horizontal" ? 720 : 1280;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial,${st.fontSize},${st.primary},&H000000FF,&H00000000,&H90000000,${st.bold},0,0,0,100,100,0,0,1,${st.outline},${st.shadow},2,58,58,${st.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const body = cues
    .map((cue) => {
      const wrapped = wrapSubtitleText(cue.text, aspectRatio, styleName);
      return `Dialogue: 0,${cue.start},${cue.end},Main,,0,0,0,,${escapeAssText(wrapped)}`;
    })
    .join("\n");

  return `${header}\n${body}\n`;
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function installSubtitleRoutes(app) {
  if (app.__subtitleRoutesInstalled) return;
  app.__subtitleRoutesInstalled = true;

  app.post("/api/transcribe/srt", subtitleUpload.single("audio"), async (req, res) => {
    const id = req.reqId || reqId();
    const file = req.file;
    const workDir = path.join(TMP_ROOT, `transcribe_${Date.now()}_${id}`);

    try {
      if (!client) {
        return res.status(500).json({ ok: false, error: "OPENAI_API_KEY manquante pour la transcription." });
      }
      if (!file) {
        return res.status(400).json({ ok: false, error: "Audio manquant." });
      }

      await ensureDir(workDir);

      const startSec = safeNumber(req.body?.audioStartSec, 0);
      const endSec = safeNumber(req.body?.audioEndSec, 0);
      const preparedAudio = await prepareAudioForTranscription(file.path, workDir, id, startSec, endSec);

      log(id, "OPENAI TRANSCRIBE START", TRANSCRIBE_MODEL);

      const srt = await client.audio.transcriptions.create({
        file: fs.createReadStream(preparedAudio),
        model: TRANSCRIBE_MODEL,
        response_format: "srt",
        language: "fr"
      });

      const cleanSrt = typeof srt === "string" ? srt : String(srt || "");
      const style = safeText(req.body?.subtitleStyle || "rap") || "rap";
      const aspectRatio = safeText(req.body?.aspectRatio || "vertical") || "vertical";
      const ass = buildAssFromSrt(cleanSrt, style, aspectRatio);

      log(id, "OPENAI TRANSCRIBE OK", `${cleanSrt.length} chars style=${style}`);

      res.json({
        ok: true,
        source: "openai_whisper",
        model: TRANSCRIBE_MODEL,
        srt: cleanSrt,
        ass,
        style
      });
    } catch (error) {
      console.error(`[${id}] TRANSCRIBE ERROR`, error);
      res.status(500).json({
        ok: false,
        error: error.message || "Impossible de transcrire l’audio."
      });
    } finally {
      await removePathQuietly(file?.path);
      await removePathQuietly(workDir);
    }
  });

  app.post(
    "/api/subtitles/burn-video",
    subtitleUpload.fields([{ name: "video", maxCount: 1 }]),
    async (req, res) => {
      const id = req.reqId || reqId();
      const videoFile = req.files?.video?.[0] || null;
      const workDir = path.join(TMP_ROOT, `burn_${Date.now()}_${id}`);

      try {
        if (!videoFile) {
          return res.status(400).json({ ok: false, error: "Vidéo manquante." });
        }

        const srt = safeText(req.body?.srt || "");
        if (!srt) {
          return res.status(400).json({ ok: false, error: "Sous-titres manquants." });
        }

        await ensureDir(workDir);

        const style = safeText(req.body?.subtitleStyle || "rap") || "rap";
        const aspectRatio = safeText(req.body?.aspectRatio || "vertical") || "vertical";
        const ass = buildAssFromSrt(srt, style, aspectRatio);
        const assPath = path.join(workDir, "subtitles.ass");
        const outputPath = path.join(workDir, "video_subtitled.mp4");

        await fsp.writeFile(assPath, ass, "utf8");

        await runFfmpeg(
          [
            "-y",
            "-i",
            videoFile.path,
            "-vf",
            `ass=${escapeFilterPath(assPath)}`,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            outputPath
          ],
          id,
          `burn subtitles style=${style}`
        );

        const stat = await fsp.stat(outputPath);
        log(id, "BURN SUBTITLES OK", `${stat.size} bytes`);

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Disposition", "inline; filename=video_sous_titres.mp4");

        const stream = fs.createReadStream(outputPath);
        stream.on("close", async () => {
          await removePathQuietly(videoFile.path);
          await removePathQuietly(workDir);
        });
        stream.on("error", async (error) => {
          console.error(`[${id}] BURN STREAM ERROR`, error);
          await removePathQuietly(videoFile.path);
          await removePathQuietly(workDir);
        });
        stream.pipe(res);
      } catch (error) {
        console.error(`[${id}] BURN SUBTITLES ERROR`, error);
        await removePathQuietly(videoFile?.path);
        await removePathQuietly(workDir);
        res.status(500).json({
          ok: false,
          error: error.message || "Impossible d’incruster les sous-titres."
        });
      }
    }
  );

  console.log("Routes sous-titres OpenAI chargées V21 affichage adapté.");
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installSubtitleRoutes(this);
  return originalListen.apply(this, args);
};
