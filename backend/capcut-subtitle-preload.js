import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-capcut-subtitles");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const upload = multer({
  dest: TMP_ROOT,
  limits: {
    fileSize: 260 * 1024 * 1024,
    files: 1
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
  try { await fsp.rm(targetPath, { recursive: true, force: true }); } catch {}
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
      if (stderr.length > 9000) stderr = stderr.slice(-9000);
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

function secondsToSrtTime(value) {
  const totalMs = Math.max(0, Math.round(safeNumber(value, 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function srtTimeToSeconds(value) {
  const match = safeText(value).replace(",", ".").match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) + Number(`0.${match[4] || "0"}`);
}

function rebaseSrtToZero(srt) {
  const clean = safeText(srt);
  const first = clean.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->/);
  const offset = first ? srtTimeToSeconds(first[1]) : 0;
  if (!offset || offset < 0.35) return clean;
  return clean.replace(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => {
    return `${secondsToSrtTime(srtTimeToSeconds(start) - offset)} --> ${secondsToSrtTime(srtTimeToSeconds(end) - offset)}`;
  });
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
  return safeText(text).replace(/\\N/g, " ").replace(/\s+/g, " ").trim();
}

function wrapSubtitleText(text, aspectRatio = "vertical", styleName = "classic") {
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
  return lines.join("\\N");
}

function parseSrt(srt) {
  const blocks = safeText(srt).replace(/\r/g, "").split(/\n\s*\n/g).map((block) => block.trim()).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim());
    const text = lines.slice(timeIndex + 1).join(" ").replace(/\{[^}]*\}/g, "");
    if (!text) continue;
    cues.push({ start: srtTimeToAss(startRaw), end: srtTimeToAss(endRaw), text });
  }
  return cues;
}

function escapeAssText(text) {
  return safeText(text)
    .replace(/\r/g, "")
    .replace(/\n/g, "\\N")
    .replace(/\{/g, "")
    .replace(/\}/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim();
}

function subtitleStyle(styleName, aspectRatio) {
  const vertical = aspectRatio !== "horizontal";
  const styles = {
    classic: { fontSize: vertical ? 38 : 32, primary: "&H00FFFFFF", secondary: "&H0000FFFF", outline: 3, shadow: 1, marginV: vertical ? 120 : 56, bold: -1 },
    tiktok: { fontSize: vertical ? 42 : 36, primary: "&H0000FFFF", secondary: "&H00FFFFFF", outline: 4, shadow: 2, marginV: vertical ? 145 : 70, bold: -1 },
    cinema: { fontSize: vertical ? 34 : 30, primary: "&H00F4F4F4", secondary: "&H00E5E5E5", outline: 2, shadow: 1, marginV: vertical ? 105 : 48, bold: 0 },
    rap: { fontSize: vertical ? 40 : 34, primary: "&H00FFFFFF", secondary: "&H0000FFFF", outline: 4, shadow: 2, marginV: vertical ? 125 : 62, bold: -1 }
  };
  return styles[styleName] || styles.classic;
}

function assHeader(styleName = "classic", aspectRatio = "vertical") {
  const st = subtitleStyle(styleName, aspectRatio);
  const playResX = aspectRatio === "horizontal" ? 1280 : 720;
  const playResY = aspectRatio === "horizontal" ? 720 : 1280;
  return `[Script Info]
Title: CapCut OpenAI Subtitles
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial,${st.fontSize},${st.primary},${st.secondary},&H00000000,&H90000000,${st.bold},0,0,0,100,100,0,0,1,${st.outline},${st.shadow},2,58,58,${st.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

function buildAssFromSrt(srt, styleName = "classic", aspectRatio = "vertical") {
  const cues = parseSrt(srt);
  const header = assHeader(styleName, aspectRatio);
  const body = cues.map((cue) => {
    const wrapped = wrapSubtitleText(cue.text, aspectRatio, styleName);
    return `Dialogue: 0,${cue.start},${cue.end},Main,,0,0,0,,${escapeAssText(wrapped)}`;
  }).join("\n");
  return `${header}\n${body}\n`;
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function extractAudio(inputPath, outputPath, id) {
  await runFfmpeg(["-y", "-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "48k", outputPath], id, "capcut extract audio once");
}

async function burnSubtitles(inputVideo, assPath, outputPath, id) {
  await runFfmpeg([
    "-y",
    "-i", inputVideo,
    "-vf", `ass=${escapeFilterPath(assPath)}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath
  ], id, "capcut burn openai subtitles");
}

function installCapCutSubtitleRoute(app) {
  if (app.__capcutSubtitleRouteInstalled) return;
  app.__capcutSubtitleRouteInstalled = true;

  app.post("/api/capcut/openai-subtitles", upload.single("video"), async (req, res) => {
    const id = req.reqId || reqId();
    const file = req.file;
    const workDir = path.join(TMP_ROOT, `capcut_${Date.now()}_${id}`);

    try {
      if (!client) return res.status(500).json({ ok: false, error: "OPENAI_API_KEY manquante pour la transcription." });
      if (!file) return res.status(400).json({ ok: false, error: "Vidéo CapCut manquante." });
      await ensureDir(workDir);

      const style = safeText(req.body?.subtitleStyle || "classic") || "classic";
      const aspectRatio = safeText(req.body?.aspectRatio || "vertical") || "vertical";
      const audioPath = path.join(workDir, "capcut_audio.mp3");
      const assPath = path.join(workDir, "capcut_subtitles.ass");
      const outputPath = path.join(workDir, "capcut_openai_sous_titres.mp4");

      log(id, "CAPCUT OPENAI START", `${file.originalname || "video"} size=${file.size || 0} style=${style} ratio=${aspectRatio}`);
      await extractAudio(file.path, audioPath, id);

      log(id, "OPENAI CAPCUT TRANSCRIBE START", TRANSCRIBE_MODEL);
      const srtRaw = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: TRANSCRIBE_MODEL,
        response_format: "srt",
        language: "fr"
      });
      const srt = rebaseSrtToZero(typeof srtRaw === "string" ? srtRaw : String(srtRaw || ""));
      if (!srt.includes("-->")) throw new Error("OpenAI n’a pas renvoyé de sous-titres exploitables.");
      log(id, "OPENAI CAPCUT TRANSCRIBE OK", `${srt.length} chars`);

      const ass = buildAssFromSrt(srt, style, aspectRatio);
      await fsp.writeFile(assPath, ass, "utf8");
      await burnSubtitles(file.path, assPath, outputPath, id);

      const stat = await fsp.stat(outputPath);
      log(id, "CAPCUT OPENAI SUBTITLES OK", `${stat.size} bytes`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", "inline; filename=capcut_openai_sous_titres.mp4");
      res.setHeader("X-OpenAI-SRT-Length", String(srt.length));

      const stream = fs.createReadStream(outputPath);
      stream.on("close", async () => { await removePathQuietly(file?.path); await removePathQuietly(workDir); });
      stream.on("error", async (error) => { console.error(`[${id}] CAPCUT STREAM ERROR`, error); await removePathQuietly(file?.path); await removePathQuietly(workDir); });
      stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] CAPCUT OPENAI SUBTITLES ERROR`, error);
      await removePathQuietly(file?.path);
      await removePathQuietly(workDir);
      res.status(500).json({ ok: false, error: error.message || "Impossible de créer la vidéo CapCut sous-titrée." });
    }
  });

  console.log("Route CapCut sous-titres OpenAI chargée V41 upload unique.");
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installCapCutSubtitleRoute(this);
  return originalListen.apply(this, args);
};
