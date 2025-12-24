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
   ✅ FINAL CORS CONFIG (NODE 22 + RENDER SAFE)
-------------------------------------------------- */
const allowedOrigins = [
  "https://msimbi.com",
  "https://www.msimbi.com",
  "https://lovable.dev",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Render health checks, curl, etc.)
    if (!origin) return callback(null, true);

    // Exact matches
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Lovable dynamic subdomains
    if (
      origin.endsWith(".lovable.app") ||
      origin.endsWith(".lovableproject.com")
    ) {
      return callback(null, true);
    }

    console.error("❌ Blocked by CORS:", origin);
    return callback(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
};

app.use(cors(corsOptions));
app.options("/*", cors(corsOptions)); // ✅ FIXED (was "*", breaks Node 22)
app.use(express.json({ limit: "50mb" }));

/* -------------------------------------------------
   Folders
-------------------------------------------------- */
const JOBS_DIR = path.join(__dirname, "jobs");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

/* -------------------------------------------------
   Multer (file uploads)
-------------------------------------------------- */
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

/* -------------------------------------------------
   Health check (Render)
-------------------------------------------------- */
app.get("/", (_, res) => {
  res.send("Msimbi Render Server is running");
});

/* -------------------------------------------------
   Render endpoint
-------------------------------------------------- */
app.post("/render", upload.array("files"), async (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    if (!req.body.timeline) {
      return res.status(400).json({ error: "Missing timeline" });
    }

    const timeline = JSON.parse(req.body.timeline);
    fs.writeFileSync(
      path.join(jobDir, "timeline.json"),
      JSON.stringify(timeline, null, 2)
    );

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No media files uploaded" });
    }

    // Temporary simple render (first video only)
    const inputVideo = req.files.find(f =>
      f.mimetype.startsWith("video/")
    );

    if (!inputVideo) {
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
      if (code !== 0) {
        console.error(`❌ FFmpeg failed for job ${jobId}`);
      } else {
        console.log(`✅ Render complete for job ${jobId}`);
      }
    });

    // Respond immediately (Lovable expects async export)
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

/* -------------------------------------------------
   Download endpoint
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "File not ready" });
  }

  res.download(file);
});

/* -------------------------------------------------
   Start server (Render controls PORT)
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 Render server listening on port ${PORT}`);
});
