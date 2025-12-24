import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();

// Allow Lovable frontend
app.use(cors({ origin: "https://msimbi.com" }));
app.use(express.json());

// Folders
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config
const upload = multer({ dest: UPLOADS_DIR });

// Helper: Run FFmpeg command
function runFFmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stdout.on("data", (data) => console.log(`[FFmpeg ${jobId} stdout] ${data}`));
    ffmpeg.stderr.on("data", (data) => console.log(`[FFmpeg ${jobId} stderr] ${data}`));

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

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

    const inputFiles = {};
    req.files.forEach(file => {
      inputFiles[file.originalname] = file.path;
    });

    const inputArgs = [];
    const filterComplexParts = [];
    const videoLabels = [];
    const audioLabels = [];

    // Process each clip
    timeline.clips.forEach((clip, index) => {
      const inputPath = inputFiles[clip.fileName];
      if (!inputPath) throw new Error(`Clip file not uploaded: ${clip.fileName}`);

      inputArgs.push("-i", inputPath);

      const vLabel = `v${index}`;
      const aLabel = `a${index}`;

      // Video trim and speed
      let videoFilter = `[${index}:v]trim=start=${clip.start || 0}:end=${clip.end || clip.duration},setpts=PTS-STARTPTS`;
      if (clip.speed && clip.speed !== 1) videoFilter += `,setpts=${1/clip.speed}*PTS`;

      // Scale
      if (clip.width && clip.height) videoFilter += `,scale=${clip.width}:${clip.height}`;

      // Text overlays
      if (clip.text) {
        videoFilter += `,drawtext=text='${clip.text}':x=${clip.x || "(w-text_w)/2"}:y=${clip.y || "h-80"}:fontsize=${clip.fontSize || 24}:fontcolor=${clip.color || "white"}:enable='between(t,${clip.start || 0},${clip.end || clip.duration})'`;
      }

      // Image overlays (stickers)
      if (clip.images && clip.images.length > 0) {
        clip.images.forEach((img, imgIndex) => {
          videoFilter += `,overlay=x=${img.x || 0}:y=${img.y || 0}:enable='between(t,${img.start || 0},${img.end || clip.end || clip.duration})'`;
        });
      }

      filterComplexParts.push(`${videoFilter}[${vLabel}]`);

      // Audio trim, speed, volume
      let audioFilter = `[${index}:a]atrim=start=${clip.start || 0}:end=${clip.end || clip.duration},asetpts=PTS-STARTPTS`;
      if (clip.speed && clip.speed !== 1) audioFilter += `,atempo=${clip.speed}`;
      if (clip.volume !== undefined) audioFilter += `,volume=${clip.volume}`;
      filterComplexParts.push(`${audioFilter}[${aLabel}]`);

      videoLabels.push(vLabel);
      audioLabels.push(aLabel);
    });

    // Concatenate all videos
    const concatVideos = videoLabels.map(l => `[${l}]`).join("");
    const concatAudios = audioLabels.map(l => `[${l}]`).join("");

    filterComplexParts.push(`${concatVideos}concat=n=${videoLabels.length}:v=1:a=0[vid]`);
    filterComplexParts.push(`${concatAudios}concat=n=${audioLabels.length}:v=0:a=1[aud]`);

    const outputVideo = path.join(jobDir, "output.mp4");

    const ffmpegArgs = [
      ...inputArgs,
      "-filter_complex", filterComplexParts.join(";"),
      "-map", "[vid]",
      "-map", "[aud]",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y",
      outputVideo
    ];

    await runFFmpeg(ffmpegArgs, jobId);

    console.log(`Render complete for job ${jobId}`);
    res.json({ jobId, message: "Render complete, download when ready" });

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render server running on port ${PORT}`);
});
