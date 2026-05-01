import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";

const ROOT = path.join(os.tmpdir(), "montage-ia-capcut-large");
fs.mkdirSync(ROOT, { recursive: true });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const uploadChunk = multer({ dest: ROOT, limits: { fileSize: 520 * 1024 * 1024, files: 1 } });
const uploadAudio = multer({ dest: ROOT, limits: { fileSize: 120 * 1024 * 1024, files: 1 } });

function reqId() { return Math.random().toString(36).slice(2, 8); }
function log(id, msg, extra = "") { console.log(`[${id}] ${msg}${extra ? ` ${extra}` : ""}`); }
function safeText(value) { return (value || "").toString().trim(); }
function safeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }
async function rmQuiet(p) { try { if (p) await fsp.rm(p, { recursive: true, force: true }); } catch {} }

function run(cmdArgs, id, label) {
  return new Promise((resolve, reject) => {
    log(id, "FFMPEG START", label);
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...cmdArgs], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on("close", (code) => code === 0 ? (log(id, "FFMPEG OK", label), resolve()) : reject(new Error(`FFmpeg ${label} a échoué. ${stderr}`)));
    child.on("error", reject);
  });
}

function runProbe(args, id, label) {
  return new Promise((resolve, reject) => {
    log(id, "FFPROBE START", label);
    const ffprobe = ffmpegPath.replace(/ffmpeg(?:\.exe)?$/, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    const child = spawn(ffprobe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => code === 0 ? (log(id, "FFPROBE OK", label), resolve(out)) : reject(new Error(`ffprobe ${label} impossible. ${err}`)));
    child.on("error", reject);
  });
}

async function durationOf(file, id) {
  const out = await runProbe(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], id, "duration");
  return Math.max(1, safeNumber(out, 1));
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

function srtToSeconds(value) {
  const m = safeText(value).replace(",", ".").match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(`0.${m[4] || "0"}`);
}

function rebaseSrtToZero(srt) {
  const clean = safeText(srt);
  const first = clean.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->/);
  const offset = first ? srtToSeconds(first[1]) : 0;
  if (!offset || offset < 0.35) return clean;
  return clean.replace(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => `${secondsToSrtTime(srtToSeconds(start) - offset)} --> ${secondsToSrtTime(srtToSeconds(end) - offset)}`);
}

function parseSrt(srt) {
  const blocks = safeText(srt).replace(/\r/g, "").split(/\n\s*\n/g).map((b) => b.trim()).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeIndex].split("-->").map((p) => p.trim());
    const text = lines.slice(timeIndex + 1).join(" ").replace(/\{[^}]*\}/g, "").trim();
    if (!text) continue;
    cues.push({ start: srtToSeconds(startRaw), end: srtToSeconds(endRaw), text });
  }
  return cues;
}

function assTime(sec) {
  const totalCs = Math.max(0, Math.round(sec * 100));
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const h = Math.floor(totalM / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAss(text) {
  return safeText(text).replace(/\r/g, "").replace(/\n/g, "\\N").replace(/[{}]/g, "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
}

function wrapText(text, ratio, style) {
  const clean = safeText(text).replace(/\s+/g, " ").trim();
  const max = ratio === "horizontal" ? 42 : (style === "tiktok" ? 22 : 26);
  const words = clean.split(" ").filter(Boolean);
  const lines = []; let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) { lines.push(line); line = word; if (lines.length >= 2) break; }
    else line = next;
  }
  if (line && lines.length < 2) lines.push(line);
  return lines.join("\\N");
}

function styleConfig(styleName, ratio) {
  const vertical = ratio !== "horizontal";
  const map = {
    classic: { fontSize: vertical ? 38 : 32, color: "&H00FFFFFF", outline: 3, shadow: 1, marginV: vertical ? 120 : 56, bold: -1 },
    tiktok: { fontSize: vertical ? 42 : 36, color: "&H0000FFFF", outline: 4, shadow: 2, marginV: vertical ? 145 : 70, bold: -1 },
    cinema: { fontSize: vertical ? 34 : 30, color: "&H00F4F4F4", outline: 2, shadow: 1, marginV: vertical ? 105 : 48, bold: 0 },
    rap: { fontSize: vertical ? 40 : 34, color: "&H00FFFFFF", outline: 4, shadow: 2, marginV: vertical ? 125 : 62, bold: -1 }
  };
  return map[styleName] || map.classic;
}

function assHeader(styleName, ratio) {
  const st = styleConfig(styleName, ratio);
  const x = ratio === "horizontal" ? 1280 : 720;
  const y = ratio === "horizontal" ? 720 : 1280;
  return `[Script Info]\nTitle: Large OpenAI Subtitles\nScriptType: v4.00+\nPlayResX: ${x}\nPlayResY: ${y}\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Main,Arial,${st.fontSize},${st.color},&H00FFFFFF,&H00000000,&H90000000,${st.bold},0,0,0,100,100,0,0,1,${st.outline},${st.shadow},2,58,58,${st.marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

function buildAssForWindow(cues, start, end, styleName, ratio) {
  const header = assHeader(styleName, ratio);
  const body = cues.filter((cue) => cue.end > start && cue.start < end).map((cue) => {
    const localStart = Math.max(0, cue.start - start);
    const localEnd = Math.max(localStart + 0.2, cue.end - start);
    return `Dialogue: 0,${assTime(localStart)},${assTime(localEnd)},Main,,0,0,0,,${escapeAss(wrapText(cue.text, ratio, styleName))}`;
  }).join("\n");
  return `${header}\n${body}\n`;
}

function filterPath(p) { return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'"); }

async function transcribe(audioPath, id) {
  if (!client) throw new Error("OPENAI_API_KEY manquante.");
  log(id, "LARGE OPENAI TRANSCRIBE START", TRANSCRIBE_MODEL);
  const raw = await client.audio.transcriptions.create({ file: fs.createReadStream(audioPath), model: TRANSCRIBE_MODEL, response_format: "srt", language: "fr" });
  const srt = rebaseSrtToZero(typeof raw === "string" ? raw : String(raw || ""));
  if (!srt.includes("-->")) throw new Error("OpenAI n’a pas renvoyé de SRT exploitable.");
  log(id, "LARGE OPENAI TRANSCRIBE OK", `${srt.length} chars`);
  return srt;
}

async function assembleChunks(jobDir, total, output, id) {
  log(id, "LARGE ASSEMBLE START", `${total} chunks`);
  const write = fs.createWriteStream(output);
  for (let i = 0; i < total; i++) {
    const p = path.join(jobDir, "chunks", `chunk_${String(i).padStart(4, "0")}`);
    await new Promise((resolve, reject) => {
      const read = fs.createReadStream(p);
      read.on("error", reject);
      read.on("end", resolve);
      read.pipe(write, { end: false });
    });
  }
  await new Promise((resolve) => write.end(resolve));
  log(id, "LARGE ASSEMBLE OK", output);
}

async function processLarge({ id, jobDir, videoPath, audioPath, style, ratio, segmentCount }) {
  const srt = await transcribe(audioPath, id);
  const cues = parseSrt(srt);
  const duration = await durationOf(videoPath, id);
  const count = Math.max(2, Math.min(12, safeNumber(segmentCount, 7)));
  const segDuration = duration / count;
  const processed = [];

  for (let i = 0; i < count; i++) {
    const start = i * segDuration;
    const dur = i === count - 1 ? Math.max(0.5, duration - start) : segDuration;
    const rawSeg = path.join(jobDir, `raw_${i}.mp4`);
    const ass = path.join(jobDir, `subs_${i}.ass`);
    const outSeg = path.join(jobDir, `sub_${i}.mp4`);
    await run(["-y", "-ss", String(start), "-t", String(dur), "-i", videoPath, "-c", "copy", "-avoid_negative_ts", "make_zero", rawSeg], id, `split ${i + 1}/${count}`);
    await fsp.writeFile(ass, buildAssForWindow(cues, start, start + dur, style, ratio), "utf8");
    await run(["-y", "-i", rawSeg, "-vf", `ass=${filterPath(ass)}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outSeg], id, `burn segment ${i + 1}/${count}`);
    processed.push(outSeg);
  }

  const listPath = path.join(jobDir, "concat.txt");
  await fsp.writeFile(listPath, processed.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const finalPath = path.join(jobDir, "final_large_openai_subtitles.mp4");
  await run(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", finalPath], id, "concat final large");
  return { finalPath, srtLength: srt.length };
}

function install(app) {
  if (app.__capcutLargeInstalled) return;
  app.__capcutLargeInstalled = true;

  app.post("/api/capcut-large/init", express.json({ limit: "1mb" }), async (req, res) => {
    const id = reqId();
    const jobId = crypto.randomUUID();
    const jobDir = path.join(ROOT, jobId);
    await ensureDir(path.join(jobDir, "chunks"));
    await fsp.writeFile(path.join(jobDir, "meta.json"), JSON.stringify({ jobId, createdAt: Date.now(), name: req.body?.name || "video.mp4" }, null, 2));
    log(id, "LARGE INIT", jobId);
    res.json({ ok: true, jobId });
  });

  app.post("/api/capcut-large/chunk", uploadChunk.single("chunk"), async (req, res) => {
    const id = req.reqId || reqId();
    const jobId = safeText(req.body?.jobId);
    const index = safeNumber(req.body?.index, -1);
    const total = safeNumber(req.body?.total, 0);
    if (!jobId || index < 0 || !req.file) return res.status(400).json({ ok: false, error: "Chunk invalide." });
    const jobDir = path.join(ROOT, jobId);
    const chunksDir = path.join(jobDir, "chunks");
    await ensureDir(chunksDir);
    const dest = path.join(chunksDir, `chunk_${String(index).padStart(4, "0")}`);
    await fsp.rename(req.file.path, dest);
    log(id, "LARGE CHUNK OK", `${index + 1}/${total} job=${jobId}`);
    res.json({ ok: true, index, total });
  });

  app.post("/api/capcut-large/process", uploadAudio.single("audio"), async (req, res) => {
    const id = req.reqId || reqId();
    const jobId = safeText(req.body?.jobId);
    const total = safeNumber(req.body?.total, 0);
    const style = safeText(req.body?.subtitleStyle || "classic") || "classic";
    const ratio = safeText(req.body?.aspectRatio || "vertical") || "vertical";
    const segmentCount = safeNumber(req.body?.segmentCount, 7);
    const jobDir = path.join(ROOT, jobId);
    const videoPath = path.join(jobDir, "assembled_video.mp4");

    try {
      if (!jobId || !total) return res.status(400).json({ ok: false, error: "Job invalide." });
      if (!req.file) return res.status(400).json({ ok: false, error: "Audio manquant." });
      log(id, "LARGE PROCESS START", `job=${jobId} chunks=${total} segments=${segmentCount}`);
      await assembleChunks(jobDir, total, videoPath, id);
      const result = await processLarge({ id, jobDir, videoPath, audioPath: req.file.path, style, ratio, segmentCount });
      const stat = await fsp.stat(result.finalPath);
      log(id, "LARGE FINAL OK", `${stat.size} bytes`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", "inline; filename=large_openai_subtitles.mp4");
      res.setHeader("X-OpenAI-SRT-Length", String(result.srtLength));
      const stream = fs.createReadStream(result.finalPath);
      stream.on("close", async () => { await rmQuiet(req.file?.path); await rmQuiet(jobDir); });
      stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] LARGE PROCESS ERROR`, error);
      await rmQuiet(req.file?.path);
      res.status(500).json({ ok: false, error: error.message || "Traitement gros fichier impossible." });
    }
  });

  console.log("Route CapCut gros fichier automatique chargée V44.");
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) { install(this); return originalListen.apply(this, args); };
