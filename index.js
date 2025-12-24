import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();

// Allow requests from msimbi.com and Lovable preview domains
app.use(cors({
  origin: [
    "https://msimbi.com",
    /\.lovableproject\.com$/,
    /\.lovable\.app$/
  ]
}));

app.use(express.json());

// Folders
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config for file uploads
const upload = multer({ dest: UPLOADS_DIR });

// --- Render endpoint ---
app.post("/render", upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const timeline = JSON.parse(req.body.timeline);
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save timeline JSON
    fs.writeFileSync(
      path.join(jobDir, "timeline.json"),
      JSON.stringify(timeline, null, 2)
    );

    const outputVideo = path.join(jobDir, "output.mp4");

    // Build FFmpeg input arguments for all clips in the timeline
    const ffmpegInputs = [];
    const filterComplexParts = [];

    timeline.clips.forEach((clip, i) => {
      const file = req.files.find(f => f.originalname === clip.fileName);
      if (!file) return;

      ffmpegInputs.push("-i", file.path);

      // Prepare video filter chain per clip
      const start = clip.startPosition || 0;
      const duration = clip.effectiveDuration || 5; // default 5s
      let filter = `[${i}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS`;

      // Add drawtext if provided
      if (clip.text) {
        filter += `,drawtext=text='${clip.text}':x=(w-text_w)/2:y=h-80:fontsize=24:fontcolor=white`;
      }

      filterComplexParts.push(filter + `[v${i}]`);
    });

    // Concatenate video streams if more than one
    let filterComplex = "";
    if (filterComplexParts.length > 1) {
      filterComplex = filterComplexParts.join("; ") +
        `; ${filterComplexParts.map((_, i) => `[v${i}]`).join("")}concat=n=${filterComplexParts.length}:v=1:a=0[outv]`;
    } else {
      filterComplex = filterComplexParts[0] + ";[v0]copy[outv]";
    }

    // Prepare FFmpeg arguments
    const ffmpegArgs = [
      ...ffmpegInputs,
      "-filter_complex", filterComplex,
      "-map", "[outv]",
      "-map", "0:a?", // optional audio from first file
      "-c:v", "libx264",
      "-c:a", "aac",
      "-b:v", timeline.settings?.videoBitrate || "3000k",
      "-b:a", timeline.settings?.audioBitrate || "128k",
      "-r", timeline.settings?.fps || 30,
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render server running on port ${PORT}`);
});

