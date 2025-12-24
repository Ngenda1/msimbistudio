import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();

// --- CORS configuration ---
const allowedOrigins = [
  "https://msimbi.com", // production
  "https://id-preview--5eec7204-b4c9-4ca7-9bf5-b31dde9c31ef.lovable.app" // Lovable preview
];

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like curl or Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
}));

app.use(express.json());

// --- Folders ---
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// --- Multer config ---
const upload = multer({ dest: UPLOADS_DIR });

// --- Render endpoint ---
app.post("/render", upload.array("files"), (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save timeline JSON
    const timeline = JSON.parse(req.body.timeline || "{}");
    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Use first uploaded video
    const inputVideo = req.files[0].path;
    const outputVideo = path.join(jobDir, "output.mp4");

    // FFmpeg command
    const ffmpegArgs = [
      "-i", inputVideo,
      "-vf", "drawtext=text='Msimbi Export':x=(w-text_w)/2:y=h-80",
      "-y",
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stderr.on("data", data => {
      console.log(`[FFmpeg ${jobId}] ${data}`);
    });

    ffmpeg.on("close", code => {
      console.log(`Job ${jobId} finished with code ${code}`);
    });

    res.json({ jobId, message: "Render started" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Render failed" });
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

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render server running on port ${PORT}`);
});
