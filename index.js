import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------- CORS ---------------- */
app.use(cors({
  origin: [
    "https://msimbi.com",
    "https://www.msimbi.com",
    "https://lovable.dev",
    /\.lovable(app|project)?\.com$/,
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "50mb" }));

/* ---------------- Utils ---------------- */

function uid(ext = "") {
  return crypto.randomBytes(8).toString("hex") + ext;
}

async function downloadFile(url, dest) {
  console.log("⬇️ Downloading:", url);
  const res = await fetch(url, { timeout: 300000 });

  if (!res.ok) {
    throw new Error(`Failed download ${url}: ${res.status}`);
  }

  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });

  const size = fs.statSync(dest).size;
  if (size === 0) throw new Error("Downloaded file is empty");

  console.log("✅ Saved:", dest, size, "bytes");
}

/* ---------------- Render Route ---------------- */

app.post("/render", async (req, res) => {
  const jobId = uid();
  const workDir = path.join("/tmp", jobId);
  fs.mkdirSync(workDir, { recursive: true });

  console.log("🎬 Render job started:", jobId);

  try {
    const { videoMedia = [], audioMedia = [] } = req.body;

    if (!videoMedia.length && !audioMedia.length) {
      return res.status(400).json({ error: "No media provided" });
    }

    /* -------- Phase 1: Download media -------- */
    const videoFiles = [];
    const audioFiles = [];

    for (const v of videoMedia) {
      const file = path.join(workDir, uid(".mp4"));
      await downloadFile(v.url, file);
      videoFiles.push(file);
    }

    for (const a of audioMedia) {
      const file = path.join(workDir, uid(".mp3"));
      await downloadFile(a.url, file);
      audioFiles.push(file);
    }

    console.log("📦 All media downloaded");

    /* -------- Phase 2: Build FFmpeg command -------- */

    const output = path.join(workDir, "output.mp4");

    let ffmpegInputs = "";
    videoFiles.forEach(f => ffmpegInputs += ` -i "${f}"`);
    audioFiles.forEach(f => ffmpegInputs += ` -i "${f}"`);

    let filter = "";
    let maps = "";

    if (videoFiles.length > 1) {
      filter += `[0:v]scale=1280:720:force_original_aspect_ratio=decrease[v0];`;
      for (let i = 1; i < videoFiles.length; i++) {
        filter += `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease[v${i}];`;
      }
      filter += videoFiles.map((_, i) => `[v${i}]`).join("") +
                `concat=n=${videoFiles.length}:v=1:a=0[v]`;
      maps += ` -map "[v]"`;
    } else {
      maps += ` -map 0:v`;
    }

    if (audioFiles.length) {
      maps += ` -map ${videoFiles.length}:a`;
    }

    const ffmpegCmd = `
      ffmpeg -y ${ffmpegInputs}
      ${filter ? `-filter_complex "${filter}"` : ""}
      ${maps}
      -c:v libx264 -preset fast -pix_fmt yuv420p
      -c:a aac -b:a 192k
      -movflags +faststart
      "${output}"
    `.replace(/\s+/g, " ");

    console.log("🎞 FFmpeg command:", ffmpegCmd);

    /* -------- Phase 3: Run FFmpeg -------- */

    exec(ffmpegCmd, { timeout: 0 }, (err, stdout, stderr) => {
      if (err) {
        console.error("❌ FFmpeg error:", stderr);
        return res.status(500).json({ error: "FFmpeg failed", details: stderr });
      }

      const size = fs.statSync(output).size;
      if (size < 100000) {
        return res.status(500).json({ error: "Output video invalid or empty" });
      }

      console.log("✅ Render complete:", size, "bytes");

      res.json({
        success: true,
        jobId,
        fileSize: size,
        path: output
      });
    });

  } catch (err) {
    console.error("🔥 Render failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Server ---------------- */

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Render server listening on ${PORT}`);
});


