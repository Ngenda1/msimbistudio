import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();
app.use(cors({ origin: "https://msimbi.com" }));
app.use(express.json({ limit: "100mb" }));

// Folders
const JOBS_DIR = "jobs";
const UPLOADS_DIR = "uploads";

if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config
const upload = multer({ dest: UPLOADS_DIR });

// Map Lovable filters to FFmpeg
function mapFiltersToFFmpeg(filters) {
  const ffmpegFilters = [];
  filters.forEach(f => {
    switch (f.type) {
      case "brightness": ffmpegFilters.push(`eq=brightness=${f.value}`); break;
      case "contrast": ffmpegFilters.push(`eq=contrast=${f.value}`); break;
      case "saturation": ffmpegFilters.push(`eq=saturation=${f.value}`); break;
      case "hue": ffmpegFilters.push(`hue=h=${f.value}`); break;
      case "blur": ffmpegFilters.push(`boxblur=${f.value}`); break;
      case "sharpen": ffmpegFilters.push(`unsharp=luma_msize_x=7:luma_msize_y=7:luma_amount=${f.value}`); break;
      case "invert": ffmpegFilters.push("negate"); break;
      case "grayscale": ffmpegFilters.push("hue=s=0"); break;
      default: break;
    }
  });
  return ffmpegFilters.join(",");
}

// --- Render endpoint ---
app.post("/render", upload.array("files"), (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "No files uploaded" });

    const timeline = JSON.parse(req.body.timeline);
    const jobId = uuid();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    fs.writeFileSync(path.join(jobDir, "timeline.json"), JSON.stringify(timeline, null, 2));

    const inputs = [];
    const filterParts = [];
    const audioParts = [];
    const videoMap = [];
    const audioMap = [];

    timeline.clips.forEach((clip, index) => {
      const fileObj = req.files.find(f => f.originalname === clip.fileName);
      if (!fileObj) return;

      inputs.push("-i", fileObj.path);

      // Video filter
      let vf = mapFiltersToFFmpeg(clip.filters || []);
      vf += `${vf ? "," : ""}scale=${timeline.settings.width}:${timeline.settings.height}:force_original_aspect_ratio=decrease,pad=${timeline.settings.width}:${timeline.settings.height}:(ow-iw)/2:(oh-ih)/2`;

      filterParts.push(`[${index}:v]trim=start=${clip.startPosition}:duration=${clip.effectiveDuration},setpts=PTS-STARTPTS${vf ? "," + vf : ""}[v${index}]`);
      audioParts.push(`[${index}:a]atrim=start=${clip.startPosition}:duration=${clip.effectiveDuration},asetpts=PTS-STARTPTS,volume=${clip.audioVolume || 1}[a${index}]`);

      videoMap.push(`[v${index}]`);
      audioMap.push(`[a${index}]`);
    });

    const filterComplex = [
      ...filterParts,
      ...audioParts,
      `${videoMap.join("")}concat=n=${timeline.clips.length}:v=1:a=0[v]`,
      `${audioMap.join("")}concat=n=${timeline.clips.length}:v=0:a=1[a]`
    ].join("; ");

    const outputVideo = path.join(jobDir, "output.mp4");

    const ffmpegArgs = [
      ...inputs,
      "-filter_complex", filterComplex,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "film",
      "-crf", "20",
      "-threads", "0",
      "-c:a", "aac",
      "-b:a", timeline.settings.audioBitrate || "160k",
      "-y",
      outputVideo
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stderr.on("data", data => console.log(`[FFmpeg ${jobId}] ${data}`));
    ffmpeg.on("close", code => console.log(`Job ${jobId} finished with code ${code}`));

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
app.listen(PORT, () => console.log(`Render server running on port ${PORT}`));
