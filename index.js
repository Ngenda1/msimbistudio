import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";

/* -------------------------------------------------
   Node / Path setup
-------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* -------------------------------------------------
   CORS — Lovable + Msimbi
-------------------------------------------------- */
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      const allowed =
        origin === "https://msimbi.com" ||
        origin === "https://www.msimbi.com" ||
        origin === "https://lovable.dev" ||
        origin.endsWith(".lovable.app") ||
        origin.endsWith(".lovableproject.com");

      if (allowed) return cb(null, true);

      console.error("❌ CORS blocked:", origin);
      return cb(new Error("CORS blocked"), false);
    },
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "50mb" }));

/* -------------------------------------------------
   Storage
-------------------------------------------------- */
const JOBS_DIR = path.join(__dirname, "jobs");
fs.mkdirSync(JOBS_DIR, { recursive: true });

/**
 * jobId → {
 *   status: queued | rendering | completed | failed
 *   error?: string
 * }
 */
const jobs = new Map();

/* -------------------------------------------------
   Helpers
-------------------------------------------------- */
async function downloadFile(url, outputPath) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to download asset: ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (!buffer.length) {
    throw new Error(`Downloaded asset is empty: ${url}`);
  }

  fs.writeFileSync(outputPath, buffer);
}

function runFFmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    ff.stderr.on("data", (data) => {
      console.log(`[FFmpeg ${jobId}] ${data.toString().trim()}`);
    });

    ff.on("error", (err) => {
      reject(err);
    });

    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

/* -------------------------------------------------
   Health
-------------------------------------------------- */
app.get("/", (_, res) => {
  res.send("Msimbi Render Server — OK");
});

/* -------------------------------------------------
   Render Endpoint
-------------------------------------------------- */
app.post("/render", async (req, res) => {
  const timeline = req.body?.timeline;

  /* ---- Validation (Lovable compatibility) ---- */
  if (!timeline || !Array.isArray(timeline.media)) {
    return res.status(400).json({
      error: "Invalid timeline format. Expected { timeline: { media: [] } }",
    });
  }

  const jobId = uuid();
  const jobDir = path.join(JOBS_DIR, jobId);
  const assetsDir = path.join(jobDir, "assets");

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, "timeline.json"),
    JSON.stringify(timeline, null, 2)
  );

  jobs.set(jobId, { status: "queued" });

  /* ---- Immediate response (async render) ---- */
  res.json({
    jobId,
    status: "queued",
    statusUrl: `/status/${jobId}`,
    downloadUrl: `/download/${jobId}`,
  });

  /* -------------------------------------------------
     Background render (Render-safe)
  -------------------------------------------------- */
  (async () => {
    jobs.set(jobId, { status: "rendering" });

    try {
      const inputs = [];

      for (let i = 0; i < timeline.media.length; i++) {
        const media = timeline.media[i];

        if (!media?.url || !media?.type) {
          throw new Error(`Invalid media entry at index ${i}`);
        }

        const ext = media.type === "audio" ? "aac" : "mp4";
        const localPath = path.join(assetsDir, `${i}.${ext}`);

        console.log(`⬇️ [${jobId}] Downloading asset ${i}`);
        await downloadFile(media.url, localPath);

        inputs.push({ ...media, path: localPath });
      }

      if (!inputs.length) {
        throw new Error("Timeline contains no media");
      }

      const outputPath = path.join(jobDir, "output.mp4");

      /* ---- Minimal, reliable FFmpeg pipeline ---- */
      const ffmpegArgs = [
        "-y",
        "-i",
        inputs[0].path,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outputPath,
      ];

      await runFFmpeg(ffmpegArgs, jobId);

      const stats = fs.statSync(outputPath);
      if (stats.size < 150_000) {
        throw new Error("Rendered video is suspiciously small");
      }

      jobs.set(jobId, { status: "completed" });
      console.log(`✅ Render completed: ${jobId}`);
    } catch (err) {
      console.error(`❌ Render failed [${jobId}]:`, err.message);
      jobs.set(jobId, { status: "failed", error: err.message });
    }
  })();
});

/* -------------------------------------------------
   Status
-------------------------------------------------- */
app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

/* -------------------------------------------------
   Download
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Output not ready" });
  }

  res.download(file, "rendered-video.mp4");
});

/* -------------------------------------------------
   Start (Render controls PORT)
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 Render server running on port ${PORT}`);
});




