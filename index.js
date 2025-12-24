import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();

// Allow CORS from msimbi.com and Lovable preview domains
app.use(cors({
  origin: [
    "https://www.msimbi.com",
    "https://msimbi.com",
    "https://lovable.dev",
    "https://*.lovableproject.com",
    "https://*.lovable.app"
  ]
}));

app.use(express.json({ limit: "50mb" }));

// Folders
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config
const upload = multer({ dest: UPLOADS_DIR });

// --- Render endpoint ---
app.post("/render", upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save timeline JSON
    const timeline = JSON.parse(req.body.timeline);
    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    // Process each clip to a standard format (re-encode)
    const clipFiles = [];

    for (let i = 0; i < timeline.clips.length; i++) {
      const clip = timeline.clips[i];
      const inputFile = req.files.find(f => f.originalname === clip.fileName);
      if (!inputFile) continue;

      const clipOutput = path.join(jobDir, `clip_${i}.mp4`);

      // Video filters
      const filters = [];
      if (clip.filters) {
        if (clip.filters.brightness !== undefined) filters.push(`eq=brightness=${clip.filters.brightness}`);
        if (clip.filters.contrast !== undefined) filters.push(`eq=contrast=${clip.filters.contrast}`);
        if (clip.filters.saturation !== undefined) filters.push(`eq=saturation=${clip.filters.saturation}`);
        if (clip.filters.hue !== undefined) filters.push(`hue=h=${clip.filters.hue}`);
        // Additional filters can be added here
      }
      const vf = filters.length > 0 ? filters.join(",") : undefined;

      // Audio normalization
      const af = "loudnorm=I=-16:TP=-1.5:LRA=11";

      const ffmpegArgs = [
        "-i", inputFile.path,
        ...(vf ? ["-vf", vf] : []),
        "-af", af,
        "-ss", clip.startPosition || 0,
        "-t", clip.effectiveDuration || undefined,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-r", timeline.fps || 30,
        "-y",
        clipOutput
      ].filter(arg => arg !== undefined);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffmpegArgs);

        ffmpeg.stderr.on("data", data => console.log(`[FFmpeg clip ${i}] ${data}`));
        ffmpeg.on("close", code => {
          if (code === 0) {
            clipFiles.push(clipOutput);
            resolve();
          } else {
            reject(new Error(`Clip ${i} failed with code ${code}`));
          }
        });
      });
    }

    // Create FFmpeg concat filter string
    const filterComplex = clipFiles.map((file, i) => `[${i}:v:0][${i}:a:0]`).join('') + `concat=n=${clipFiles.length}:v=1:a=1[outv][outa]`;

    const finalOutput = path.join(jobDir, "output.mp4");

    // Prepare FFmpeg inputs
    const ffmpegInputArgs = [];
    clipFiles.forEach(file => ffmpegInputArgs.push("-i", file));

    // Run final concat with re-encode
    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        ...ffmpegInputArgs,
        "-filter_complex", filterComplex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-r", timeline.fps || 30,
        "-y",
        finalOutput
      ];

      const ffmpeg = spawn("ffmpeg", ffmpegArgs);
      ffmpeg.stderr.on("data", data => console.log(`[FFmpeg final] ${data}`));
      ffmpeg.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error(`Final export failed with code ${code}`));
      });
    });

    res.json({ jobId, message: "Render completed successfully", downloadUrl: `/download/${jobId}` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Render failed", details: err.message });
  }
});

// --- Download endpoint ---
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");
  if (fs.existsSync(file)) {
    res.download(file);
  } else {
    res.status(404).json({ error: "File not ready" });
  }
});

// Start server
const PORT = process.env.PORT || process.env.RENDER_INTERNAL_PORT || 10000;
app.listen(PORT, () => console.log(`Render server running on port ${PORT}`));


