import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";

const app = express();
app.use(express.json());

// Folder to store jobs
const JOBS_DIR = "jobs";
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);

// --- Render endpoint ---
app.post("/render", (req, res) => {
  try {
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save timeline JSON
    const timeline = req.body;
    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    // TEMP: use a test video in the repo for now
    const inputVideo = "sample.mp4"; // place sample.mp4 in root folder
    const outputVideo = path.join(jobDir, "output.mp4");

    // Build FFmpeg command
    const ffmpegArgs = [
      "-i", inputVideo,
      "-vf", "drawtext=text='Msimbi Export':x=(w-text_w)/2:y=h-80",
      "-y", // overwrite output
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stdout.on("data", (data) => {
      console.log(`FFmpeg stdout: ${data}`);
    });

    ffmpeg.stderr.on("data", (data) => {
      console.log(`FFmpeg stderr: ${data}`);
    });

    ffmpeg.on("close", (code) => {
      console.log(`Job ${jobId} finished with code ${code}`);
    });

    res.json({ jobId, message: "Render started" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start render" });
  }
});

// --- Download endpoint ---
app.get("/download/:jobId", (req, res) => {
  const file = path.join(JOBS_DIR, req.params.jobId, "output.mp4");
  if (fs.existsSync(file)) {
    res.download(file);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render server running on port ${PORT}`);
});
