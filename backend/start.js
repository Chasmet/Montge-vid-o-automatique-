process.env.MAX_RENDER_MEDIA = process.env.MAX_RENDER_MEDIA || "20";
await import("./ffmpeg-stability.js");
await import("./server.js");
