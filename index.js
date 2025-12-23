import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import multer from "multer";

const app = express();
app.use(express.json());

// --- Folders ---
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer setup for file uploads
const upload = multer({ dest: UPLOADS_DIR });

// --- Render endpoint ---
app.post("/render", upload.array("files"), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    if (!req.body.timeline) {
      return res.status(400).json({ error: "Timeline not provided" });
    }

    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save timeline JSON
    const timeline = JSON.parse(req.body.timeline);
    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    // Use first uploaded file as input video
    const inputVideo = req.files[0].path;
    const outputVideo = path.join(jobDir, "output.mp4");

    // FFmpeg command (adjust filters/arguments as needed)
    const ffmpegArgs = [
      "-i", inputVideo,
      "-vf", "drawtext=text='Msimbi Export':x=(w-text_w)/2:y=h-80",
      "-y", // overwrite if exists
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    // Logging FFmpeg output
    const logStream = fs.createWriteStream(path.join(jobDir, "render.log"));
    ffmpeg.stdout.on("data", (data) => logStream.write(data));
    ffmpeg.stderr.on("data", (data) => logStream.write(data));

    ffmpeg.on("close", (code) => {
      logStream.end();
      console.log(`Job ${jobId} finished with code ${code}`);
    });

    res.json({ jobId, message: "Render started" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start render" });
  }
});

// --- Download endpoint ---
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");
  if (fs.existsSync(file)) {
    res.download(file);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// --- Status endpoint (optional) ---
app.get("/status/:jobId", (req, res) => {
  const logFile = path.join(JOBS_DIR, req.params.jobId, "render.log");
  const outputFile = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (fs.existsSync(outputFile)) {
    return res.json({ status: "done" });
  } else if (fs.existsSync(logFile)) {
    const logs = fs.readFileSync(logFile, "utf8");
    return res.json({ status: "processing", logs });
  } else {
    return res.status(404).json({ error: "Job not found" });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render backend running on port ${PORT}`);
});
