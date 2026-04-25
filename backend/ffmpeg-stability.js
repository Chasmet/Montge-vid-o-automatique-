import { createRequire } from "module";

const require = createRequire(import.meta.url);
const childProcess = require("child_process");
const originalSpawn = childProcess.spawn;

const STYLE_VERSION = "V18";

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

function isVideoSegmentCommand(args) {
  if (!Array.isArray(args)) return false;
  const joined = args.join(" ").toLowerCase();
  return isMp4Output(args) && (joined.includes("scale=") || joined.includes("setsar=") || joined.includes("fade="));
}

function addBeforeOutput(args, extraArgs) {
  const copy = [...args];
  const outputIndex = copy.length - 1;
  copy.splice(outputIndex, 0, ...extraArgs);
  return copy;
}

function cleanBlackIntroFilter(value) {
  if (typeof value !== "string") return value;

  let next = value;

  next = next
    .replace(/,?fade=t=in:st=0(?::d=[0-9.]+)?/gi, "")
    .replace(/,?fade=type=in:start_time=0(?::duration=[0-9.]+)?/gi, "")
    .replace(/,?fade=in:st=0(?::d=[0-9.]+)?/gi, "")
    .replace(/,,+/g, ",")
    .replace(/^,|,$/g, "");

  return next || value;
}

function hasVisualStyle(value) {
  const clean = String(value || "").toLowerCase();
  return clean.includes("eq=") || clean.includes("unsharp=") || clean.includes("fps=");
}

function addLightVideoStyle(value) {
  if (typeof value !== "string") return value;
  if (hasVisualStyle(value)) return value;

  const base = cleanBlackIntroFilter(value);
  const style = "eq=contrast=1.04:saturation=1.06,unsharp=3:3:0.25";

  if (!base) return style;
  return `${base},${style}`;
}

function patchVideoFilters(args) {
  if (!Array.isArray(args)) return args;
  const next = [...args];

  for (let i = 0; i < next.length; i += 1) {
    if (["-vf", "-filter:v", "-filter_complex"].includes(next[i]) && typeof next[i + 1] === "string") {
      next[i + 1] = addLightVideoStyle(next[i + 1]);
    }
  }

  return next;
}

function patchFfmpegArgs(args) {
  if (!Array.isArray(args)) return args;

  let next = [...args];

  if (!hasArg(next, "-y")) {
    next.unshift("-y");
  }

  if (isVideoSegmentCommand(next)) {
    next = patchVideoFilters(next);
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

console.log(`FFmpeg stability patch ${STYLE_VERSION} actif : concat optimisé, faststart activé, intro noire supprimée, style clip léger activé.`);
