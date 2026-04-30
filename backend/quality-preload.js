import express from "express";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const TMP_ROOT = path.join(os.tmpdir(), "montage-ia-quality");
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({ dest: TMP_ROOT, limits: { fileSize: 280 * 1024 * 1024, files: 2 } });

function safeText(value) { return (value || "").toString().trim(); }
function reqId() { return Math.random().toString(36).slice(2, 8); }
function log(id, msg, extra = "") { console.log(`[${id}] ${msg}${extra ? ` ${extra}` : ""}`); }
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }
async function removePathQuietly(p) { if (!p) return; try { await fsp.rm(p, { recursive: true, force: true }); } catch {} }

function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    log(id, "FFMPEG START", label);
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 7000) stderr = stderr.slice(-7000);
    });
    child.on("close", (code) => code === 0 ? (log(id, "FFMPEG OK", label), resolve()) : reject(new Error(`FFmpeg ${label} a échoué.${stderr ? ` ${stderr}` : ""}`)));
    child.on("error", reject);
  });
}

function getQuality(mode, aspectRatio) {
  const cleanMode = safeText(mode || "propre").toLowerCase();
  const horizontal = safeText(aspectRatio) === "horizontal";
  if (cleanMode === "ultra") {
    const target = horizontal ? "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    return { label: "Ultra net 1080p", filter: `${target},setsar=1,hqdn3d=1.4:1.4:5:5,unsharp=5:5:0.85:5:5:0.32,eq=contrast=1.055:saturation=1.05:brightness=0.006`, crf: "22", preset: "veryfast" };
  }
  if (cleanMode === "propre") {
    return { label: "Propre HD", filter: "hqdn3d=1.1:1.1:3.5:3.5,unsharp=5:5:0.58:3:3:0.22,eq=contrast=1.035:saturation=1.035:brightness=0.004", crf: "24", preset: "veryfast" };
  }
  return { label: "Normal", filter: "null", crf: "26", preset: "ultrafast" };
}

function installQualityRoutes(app) {
  if (app.__qualityRoutesInstalled) return;
  app.__qualityRoutesInstalled = true;

  app.post("/api/video/enhance", upload.single("video"), async (req, res) => {
    const id = req.reqId || reqId();
    const file = req.file;
    const workDir = path.join(TMP_ROOT, `enhance_${Date.now()}_${id}`);
    try {
      if (!file) return res.status(400).json({ ok: false, error: "Vidéo manquante." });
      await ensureDir(workDir);
      const mode = safeText(req.body?.videoSharpnessMode || "propre") || "propre";
      const aspectRatio = safeText(req.body?.aspectRatio || "vertical") || "vertical";
      const quality = getQuality(mode, aspectRatio);
      const outputPath = path.join(workDir, `video_${mode}.mp4`);
      log(id, "VIDEO ENHANCE START", `${quality.label} / ${aspectRatio}`);
      await runFfmpeg(["-y", "-i", file.path, "-vf", quality.filter, "-c:v", "libx264", "-preset", quality.preset, "-crf", quality.crf, "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outputPath], id, `enhance ${quality.label}`);
      const stat = await fsp.stat(outputPath);
      log(id, "VIDEO ENHANCE OK", `${quality.label} ${stat.size} bytes`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `inline; filename=video_${mode}.mp4`);
      const stream = fs.createReadStream(outputPath);
      stream.on("close", async () => { await removePathQuietly(file.path); await removePathQuietly(workDir); });
      stream.on("error", async () => { await removePathQuietly(file.path); await removePathQuietly(workDir); });
      stream.pipe(res);
    } catch (error) {
      console.error(`[${id}] VIDEO ENHANCE ERROR`, error);
      await removePathQuietly(file?.path);
      await removePathQuietly(workDir);
      res.status(500).json({ ok: false, error: error.message || "Impossible d’améliorer la netteté vidéo." });
    }
  });

  console.log("Routes amélioration netteté vidéo chargées V26.");
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installQualityRoutes(this);
  return originalListen.apply(this, args);
};
