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

      if (
        origin === "https://msimbi.com" ||
        origin === "https://www.msimbi.com" ||
        origin === "https://lovable.dev" ||
        origin.endsWith(".lovable.app") ||
        origin.endsWith(".lovableproject.com")
      ) {
        return cb(null, true);
      }

      console.error("❌ CORS blocked:", origin);
      cb(null, false);
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

const jobs = new Map(); // jobId → { status }

/* -------------------------------------------------
   Helpers
-------------------------------------------------- */
async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed download: ${url}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("Downloaded file is empty");

  fs.writeFileSync(outputPath, buffer);
}

function runFFmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args);

    ff.stderr.on("data", (d) => {
      console.log(`[FFmpeg ${jobId}] ${d.toString()}`);
    });

    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}`));
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
  try {
    const timeline = req.body.timeline;
    if (!timeline) return res.status(400).json({ error: "Missing timeline" });

    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    const assetsDir = path.join(jobDir, "assets");

    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    jobs.set(jobId, { status: "rendering" });

    // Respond immediately (async job)
    res.json({
      jobId,
      status: "rendering",
      statusUrl: `/status/${jobId}`,
      downloadUrl: `/download/${jobId}`,
    });

    /* -------------------------------
       BACKGROUND RENDER
    -------------------------------- */
    (async () => {
      try {
        const inputs = [];

        for (let i = 0; i < timeline.media.length; i++) {
          const media = timeline.media[i];
          const ext = media.type === "audio" ? "aac" : "mp4";
          const localPath = path.join(assetsDir, `${i}.${ext}`);

          console.log(`⬇️ Downloading ${media.url}`);
          await downloadFile(media.url, localPath);

          inputs.push({ ...media, path: localPath });
        }

        if (inputs.length === 0) throw new Error("No media to render");

        const output = path.join(jobDir, "output.mp4");

        const ffmpegArgs = [
          "-y",
          "-i", inputs[0].path,
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-c:a", "aac",
          "-b:a", "192k",
          output,
        ];

        await runFFmpeg(ffmpegArgs, jobId);

        const stats = fs.statSync(output);
        if (stats.size < 100_000) throw new Error("Output video too small");

        jobs.set(jobId, { status: "completed" });
        console.log(`✅ Render complete: ${jobId}`);
      } catch (err) {
        console.error(`❌ Render failed ${jobId}:`, err.message);
        jobs.set(jobId, { status: "failed" });
      }
    })();
  } catch (err) {
    console.error("Render request error:", err);
    res.status(500).json({ error: "Render failed" });
  }
});

/* -------------------------------------------------
   Status
-------------------------------------------------- */
app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

/* -------------------------------------------------
   Download
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not ready" });
  res.download(file);
});

/* -------------------------------------------------
   Start (Render controls PORT)
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 Render server running on port ${PORT}`);
});




