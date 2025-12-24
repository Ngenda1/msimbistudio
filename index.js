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
   CORS CONFIG (Node 22 / Render SAFE)
-------------------------------------------------- */
const allowedOrigins = [
  "https://msimbi.com",
  "https://www.msimbi.com",
  "https://lovable.dev",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (
      origin.endsWith(".lovable.app") ||
      origin.endsWith(".lovableproject.com")
    ) {
      return callback(null, true);
    }

    console.error("❌ CORS blocked:", origin);
    return callback(null, false);
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));

/* -------------------------------------------------
   Direct OPTIONS handler (NO wildcard crash)
-------------------------------------------------- */
app.options("/render", cors(corsOptions));
app.options("/status/:jobId", cors(corsOptions));
app.options("/download/:jobId", cors(corsOptions));

/* -------------------------------------------------
   Storage folders
-------------------------------------------------- */
const JOBS_DIR = path.join(__dirname, "jobs");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

/* -------------------------------------------------
   Job store (in-memory)
-------------------------------------------------- */
const jobs = new Map();

/* -------------------------------------------------
   Multer uploads
-------------------------------------------------- */
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

/* -------------------------------------------------
   Health check
-------------------------------------------------- */
app.get("/", (_, res) => {
  res.send("🎬 Msimbi Render Server running");
});

/* -------------------------------------------------
   Render endpoint
-------------------------------------------------- */
app.post("/render", upload.array("files"), async (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    jobs.set(jobId, { status: "rendering", startedAt: Date.now() });

    if (!req.body.timeline) {
      jobs.set(jobId, { status: "failed" });
      return res.status(400).json({ error: "Missing timeline" });
    }

    const timeline = JSON.parse(req.body.timeline);
    fs.writeFileSync(
      path.join(jobDir, "timeline.json"),
      JSON.stringify(timeline, null, 2)
    );

    const inputVideo = req.files.find(f => f.mimetype.startsWith("video/"));
    if (!inputVideo) {
      jobs.set(jobId, { status: "failed" });
      return res.status(400).json({ error: "No video file found" });
    }

    const outputVideo = path.join(jobDir, "output.mp4");

    const ffmpegArgs = [
      "-y",
      "-i", inputVideo.path,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "192k",
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stderr.on("data", data => {
      console.log(`[FFmpeg ${jobId}] ${data.toString()}`);
    });

    ffmpeg.on("close", code => {
      if (code === 0) {
        jobs.set(jobId, {
          status: "completed",
          completedAt: Date.now(),
        });
        console.log(`✅ Render completed: ${jobId}`);
      } else {
        jobs.set(jobId, {
          status: "failed",
          completedAt: Date.now(),
        });
        console.error(`❌ Render failed: ${jobId}`);
      }
    });

    // Respond immediately (async workflow)
    res.json({
      jobId,
      status: "rendering",
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
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ status: "not_found" });
  }

  res.json(job);
});

/* -------------------------------------------------
   Download endpoint (ONLY after completed)
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (!job || job.status !== "completed") {
    return res.status(409).json({ error: "Render not completed" });
  }

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "File missing" });
  }

  res.download(file);
});

/* -------------------------------------------------
   Start server (Render controls PORT)
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Render server listening on port ${PORT}`);
});
