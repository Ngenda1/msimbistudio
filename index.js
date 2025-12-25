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

app.use(express.json({ limit: "100mb" }));

/* -------------------------------------------------
   Storage
-------------------------------------------------- */
const JOBS_DIR = path.join(__dirname, "jobs");
fs.mkdirSync(JOBS_DIR, { recursive: true });

const jobs = new Map(); // jobId → { status, error }

/* -------------------------------------------------
   Helpers
-------------------------------------------------- */
async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded file is empty");
  fs.writeFileSync(outputPath, buffer);
}

function runFFmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    ff.stderr.on("data", (data) => console.log(`[FFmpeg ${jobId}] ${data.toString().trim()}`));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`))));
  });
}

/* -------------------------------------------------
   Health
-------------------------------------------------- */
app.get("/", (_, res) => res.send("Msimbi Render Server — OK"));

/* -------------------------------------------------
   Render Endpoint
-------------------------------------------------- */
app.post("/render", async (req, res) => {
  const timeline = req.body?.timeline;
  if (!timeline || !Array.isArray(timeline.media)) {
    return res.status(400).json({ error: "Invalid timeline format" });
  }

  const jobId = uuid();
  const jobDir = path.join(JOBS_DIR, jobId);
  const assetsDir = path.join(jobDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

  jobs.set(jobId, { status: "queued" });
  res.json({ jobId, status: "queued", statusUrl: `/status/${jobId}`, downloadUrl: `/download/${jobId}` });

  /* ---------------------------
     Background render
  --------------------------- */
  (async () => {
    jobs.set(jobId, { status: "rendering" });
    try {
      const videoInputs = [];
      const audioInputs = [];

      for (let i = 0; i < timeline.media.length; i++) {
        const media = timeline.media[i];
        if (!media?.url || !media?.type) throw new Error(`Invalid media entry at index ${i}`);
        const ext = media.type === "audio" ? "aac" : "mp4";
        const localPath = path.join(assetsDir, `${i}.${ext}`);
        console.log(`⬇️ [${jobId}] Downloading ${media.url}`);
        await downloadFile(media.url, localPath);
        if (media.type === "video") videoInputs.push({ ...media, path: localPath });
        else audioInputs.push({ ...media, path: localPath });
      }

      if (!videoInputs.length && !audioInputs.length) throw new Error("Timeline contains no media");

      const outputPath = path.join(jobDir, "output.mp4");

      /* ---------------------------
         Build FFmpeg filter_complex
      --------------------------- */
      let filterComplex = "";
      const inputArgs = [];
      const mapArgs = [];

      // Add video inputs
      videoInputs.forEach((clip, index) => {
        inputArgs.push("-i", clip.path);
        let vf = [];

        // Trims
        if (clip.start || clip.end) vf.push(`trim=start=${clip.start || 0}:end=${clip.end || "end"}`);
        vf.push("setpts=PTS-STARTPTS");

        // Color filters
        if (clip.filters) {
          const { brightness = 0, contrast = 1, saturation = 1 } = clip.filters;
          vf.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
        }

        // Crop / scale
        if (clip.crop) {
          const { width, height, x = 0, y = 0 } = clip.crop;
          vf.push(`crop=${width}:${height}:${x}:${y}`);
        }

        // Add scaling to 1080p output
        vf.push("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2");

        filterComplex += `[${index}:v]${vf.join(",")}[v${index}];`;
      });

      // Concatenate video clips
      if (videoInputs.length > 0) {
        const concatInputs = videoInputs.map((_, idx) => `[v${idx}]`).join("");
        filterComplex += `${concatInputs}concat=n=${videoInputs.length}:v=1:a=0[outv];`;
        mapArgs.push("-map", "[outv]");
      }

      // Add audio inputs (clips + music)
      audioInputs.forEach((clip, index) => inputArgs.push("-i", clip.path));
      if (audioInputs.length > 0) {
        const audioCount = audioInputs.length;
        const audioLabels = audioInputs.map((_, i) => `[${videoInputs.length + i}:a]`).join("");
        filterComplex += `${audioLabels}amix=inputs=${audioCount}:dropout_transition=2[outa];`;
        mapArgs.push("-map", "[outa]");
      }

      // Final FFmpeg args
      const ffmpegArgs = [
        ...inputArgs,
        "-filter_complex",
        filterComplex,
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
        ...mapArgs,
        outputPath,
      ];

      await runFFmpeg(ffmpegArgs, jobId);

      const stats = fs.statSync(outputPath);
      if (stats.size < 150_000) throw new Error("Rendered video is suspiciously small");

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
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

/* -------------------------------------------------
   Download
-------------------------------------------------- */
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Output not ready" });
  res.download(file, "rendered-video.mp4");
});

/* -------------------------------------------------
   Start server
-------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎬 Render server running on port ${PORT}`));




