import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

/* ============================
   CORS CONFIG (FIXED)
   ============================ */
const allowedOrigins = [
  "https://msimbi.com",
  "https://www.msimbi.com",
  "https://lovable.dev"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (Postman, server-to-server)
      if (!origin) return callback(null, true);

      // Exact matches
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow ALL Lovable project subdomains
      if (
        origin.endsWith(".lovableproject.com") ||
        origin.endsWith(".lovable.app")
      ) {
        return callback(null, true);
      }

      console.error("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: false
  })
);

/* ============================
   JOB STORE (in-memory)
   ============================ */
const jobs = new Map();

/* ============================
   START RENDER
   ============================ */
app.post("/render", async (req, res) => {
  try {
    const jobId = uuidv4();
    const jobDir = path.join(__dirname, "jobs", jobId);
    const outputPath = path.join(jobDir, "output.mp4");

    fs.mkdirSync(jobDir, { recursive: true });

    jobs.set(jobId, {
      status: "rendering",
      outputPath,
      createdAt: Date.now()
    });

    // 🔧 Replace this with real FFmpeg render logic
    setTimeout(() => {
      fs.writeFileSync(outputPath, "FAKE VIDEO CONTENT");
      jobs.set(jobId, {
        ...jobs.get(jobId),
        status: "completed"
      });
      console.log(`✅ Render completed: ${jobId}`);
    }, 8000);

    res.json({ jobId });
  } catch (err) {
    console.error("Render error:", err);
    res.status(500).json({ error: "Failed to start render" });
  }
});

/* ============================
   STATUS CHECK
   ============================ */
app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({ status: job.status });
});

/* ============================
   DOWNLOAD
   ============================ */
app.get("/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "completed") {
    return res.status(400).json({ error: "Render not complete" });
  }

  res.download(job.outputPath, "msimbi-export.mp4");
});

/* ============================
   CLEANUP (optional)
   ============================ */
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.createdAt > 24 * 60 * 60 * 1000) {
      try {
        fs.rmSync(path.dirname(job.outputPath), { recursive: true, force: true });
      } catch {}
      jobs.delete(jobId);
    }
  }
}, 60 * 60 * 1000);

/* ============================
   START SERVER
   ============================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🎬 Render server listening on port ${PORT}`);
});


