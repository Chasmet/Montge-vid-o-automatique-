import { createRequire } from "module";

const require = createRequire(import.meta.url);
const childProcess = require("child_process");
const originalSpawn = childProcess.spawn;

function isFfmpegCommand(command) {
  return String(command || "").toLowerCase().includes("ffmpeg");
}

function hasArg(args, value) {
  return Array.isArray(args) && args.includes(value);
}

function isConcatCommand(args) {
  if (!Array.isArray(args)) return false;
  const joined = args.join(" ").toLowerCase();
  return joined.includes("concat") || joined.includes("concatlist") || joined.includes("segments.txt");
}

function isMp4Output(args) {
  if (!Array.isArray(args) || !args.length) return false;
  const last = String(args[args.length - 1] || "").toLowerCase();
  return last.endsWith(".mp4");
}

function addBeforeOutput(args, extraArgs) {
  const copy = [...args];
  const outputIndex = copy.length - 1;
  copy.splice(outputIndex, 0, ...extraArgs);
  return copy;
}

function patchFfmpegArgs(args) {
  if (!Array.isArray(args)) return args;

  let next = [...args];

  if (!hasArg(next, "-y")) {
    next.unshift("-y");
  }

  if (isMp4Output(next) && !hasArg(next, "-movflags")) {
    next = addBeforeOutput(next, ["-movflags", "+faststart"]);
  }

  if (isConcatCommand(next) && isMp4Output(next)) {
    const hasVideoCodec = hasArg(next, "-c:v") || hasArg(next, "-codec:v");
    const hasPreset = hasArg(next, "-preset");
    const hasCrf = hasArg(next, "-crf");

    if (!hasVideoCodec) {
      next = addBeforeOutput(next, ["-c:v", "libx264"]);
    }
    if (!hasPreset) {
      next = addBeforeOutput(next, ["-preset", "ultrafast"]);
    }
    if (!hasCrf) {
      next = addBeforeOutput(next, ["-crf", "28"]);
    }
    if (!hasArg(next, "-pix_fmt")) {
      next = addBeforeOutput(next, ["-pix_fmt", "yuv420p"]);
    }
  }

  return next;
}

childProcess.spawn = function patchedSpawn(command, args = [], options = {}) {
  if (isFfmpegCommand(command)) {
    const patchedArgs = patchFfmpegArgs(args);
    return originalSpawn.call(this, command, patchedArgs, options);
  }

  return originalSpawn.call(this, command, args, options);
};

console.log("FFmpeg stability patch actif : concat optimisé, faststart activé.");
