import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import cors from "cors";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";

/* -------------------------------------------------
   Basic setup
-------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* -------------------------------------------------
   CORS (Node 22 / Render safe)
-------------------------------------------------- */
const allowedOrigins = [
  "https://msimbi.com",
  "https://www.msimbi.com",
  "https://lovable.dev",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".lovable.app") ||
        origin.endsWith(".lovableproject.com")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "50mb" }));

/* -------------------------------------------------
   Folders
-------------------------------------------------- */
const JOBS_DIR = path.join(__dirname, "jobs");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

/* -------------------------------------------------
   Job store (in-memory)
-------------------------------------------------- */
const jobs = {};

/* -------------------------------------------------
   Multer
-------------------------------------------------- */
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

/* -------------------------------------------------
   Health check
-------------------------------------------------- */
app.get("/", (_, res) => {
  res.send("Msimbi Render Server running");
});

/* -------------------------------------------------
   Render endpoint
-------------------------------------------------- */
app.post("/render", upload.array("files"), async (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    jobs[jobId] = { status: "rendering" };

    if (!req.files || req.files.length === 0) {
      jobs[jobId].status = "failed";
      return res.status(400).json({ error: "No files uploaded" });
    }

    const inputVideo = req.files.find(f =>
      f.mimetype.startsWith("video/")
    );

    if (!inputVideo) {
      jobs[jobId].status = "failed";
      return res.status(400).json({ error: "No video file found" });
    }

    const outputVideo = path.join(jobDir, "output.mp4");

    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", inputVideo.path,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "192k",
      outputVideo
    ]);

    ffmpeg.stderr.on("data", data => {
      console.log(`[FFmpeg ${jobId}] ${data.toString()}`);
    });

    ffmpeg.on("close", code => {
      if (code === 0) {
        jobs[jobId].status = "completed";
        console.log(`✅ Job ${jobId} completed`);
      } else {
        jobs[jobId].status = "failed";
        console.error(`❌ Job ${jobId} failed`);
      }
    });

    res.json({
      jobId,
      status: "rendering"
    });

  } catch (err) {
    console.error("Render error:", err);
    res.status(500).json({ error: "Render failed" });
  }
});

/* -------------------------------------------------
   Job status endpoint
-------------------------------------------------- */
app.get("/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    status: job.status,
    downloadReady: job.status === "completed",
    downloadUrl:
      job.status === "completed"
        ? `/download/${req.params.jobId}`
        : null
  });
});

/* -------------------------------------------------
   Download (LOCKED until completed)
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "completed") {
    return res.status(409).json({
      error: "Export not completed yet"
    });
  }

  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "File missing" });
  }

  res.download(file);
});

/* -------------------------------------------------
   Start server
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 Render server listening on port ${PORT}`);
});
