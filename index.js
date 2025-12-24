import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();

/**
 * ✅ FIXED CORS CONFIG
 * Allows:
 * - msimbi.com (production)
 * - lovable.dev
 * - ALL lovableproject.com preview subdomains
 */
app.use(cors({
  origin: [
    "https://msimbi.com",
    "https://lovable.dev",
    /\.lovableproject\.com$/ // critical for Lovable previews
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// --------------------
// Folder setup
// --------------------
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// --------------------
// Multer config
// --------------------
const upload = multer({ dest: UPLOADS_DIR });

// --------------------
// Render endpoint
// --------------------
app.post("/render", upload.array("files"), (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);

    fs.mkdirSync(jobDir, { recursive: true });

    // Validate timeline
    if (!req.body.timeline) {
      return res.status(400).json({ error: "Timeline missing" });
    }

    const timeline = JSON.parse(req.body.timeline);
    fs.writeFileSync(
      path.join(jobDir, "timeline.json"),
      JSON.stringify(timeline, null, 2)
    );

    // Validate uploaded files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Use first uploaded video
    const inputVideo = req.files[0].path;
    const outputVideo = path.join(jobDir, "output.mp4");

    // --------------------
    // FFmpeg command
    // --------------------
    const ffmpegArgs = [
      "-i", inputVideo,
      "-vf", "drawtext=text='Msimbi Export':x=(w-text_w)/2:y=h-80:fontsize=24:fontcolor=white",
      "-y",
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stderr.on("data", data => {
      console.log(`[FFmpeg ${jobId}] ${data.toString()}`);
    });

    ffmpeg.on("close", code => {
      console.log(`Job ${jobId} finished with exit code ${code}`);
    });

    // Respond immediately (async render)
    res.json({
      jobId,
      status: "rendering",
      downloadUrl: `/download/${jobId}`
    });

  } catch (err) {
    console.error("Render error:", err);
    res.status(500).json({ error: "Render failed" });
  }
});

// --------------------
// Download endpoint
// --------------------
app.get("/download/:jobId", (req, res) => {
  const filePath = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not ready yet" });
  }
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render server running on port ${PORT}`);
});
