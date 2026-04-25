process.env.MAX_RENDER_MEDIA = process.env.MAX_RENDER_MEDIA || "30";
await import("./ffmpeg-stability.js");
await import("./server.js");
