import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const GEMINI_BACKEND = "https://montge-vid-o-automatique-1.onrender.com";

const PORT = process.env.PORT || 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 🔁 Retry simple
async function callGemini(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error("Erreur Gemini");
      return await res.json();
    } catch (e) {
      console.log(`Retry Gemini ${i + 1}`);
      await sleep(2000);
    }
  }
  throw new Error("Gemini indisponible");
}

// 🎧 Conversion MP3 léger pour Gemini
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .audioFrequency(16000)
      .duration(30)
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });
}

app.post("/api/project/prepare", upload.single("audio"), async (req, res) => {
  try {
    const audioPath = req.file.path;
    const mp3Path = audioPath + ".mp3";

    console.log("FFMPEG START gemini preview mp3");
    await convertToMp3(audioPath, mp3Path);
    console.log("FFMPEG OK gemini preview mp3");

    const audioBuffer = fs.readFileSync(mp3Path);

    // 🎯 ANALYSE
    let analysis = null;
    try {
      console.log("GEMINI ANALYZE START");
      analysis = await callGemini(
        `${GEMINI_BACKEND}/api/gemini/analyze-audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: audioBuffer,
        }
      );
      console.log("GEMINI ANALYZE OK");
    } catch (e) {
      console.log("ANALYZE FALLBACK");
    }

    // 🎬 IDEAS
    let ideas = null;
    try {
      console.log("GEMINI IDEAS START");
      ideas = await callGemini(
        `${GEMINI_BACKEND}/api/gemini/clip-ideas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis }),
        }
      );
      console.log("GEMINI IDEAS OK");
    } catch {
      console.log("IDEAS FALLBACK");
    }

    // 🎞 SELECT
    let selected = null;
    try {
      console.log("GEMINI SELECT START");
      selected = await callGemini(
        `${GEMINI_BACKEND}/api/gemini/select-media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ideas }),
        }
      );
      console.log("GEMINI SELECT OK");
    } catch {
      console.log("SELECT FALLBACK");
    }

    // 🧠 META
    let meta = null;
    try {
      console.log("GEMINI META START");
      meta = await callGemini(
        `${GEMINI_BACKEND}/api/gemini/meta-generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ideas }),
        }
      );
      console.log("GEMINI META OK");
    } catch {
      console.log("META FALLBACK");
    }

    res.json({
      analysis,
      ideas,
      selected,
      meta,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.listen(PORT, () => {
  console.log("Serveur principal démarré sur le port " + PORT);
});
