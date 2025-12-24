import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 10000;

// Ensure jobs storage folder exists
const JOBS_DIR = path.join(process.cwd(), 'jobs');
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json');
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, JSON.stringify({}));

// Utility to load and save jobs persistently
const loadJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
const saveJobs = (jobs) => fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));

// Middleware to parse JSON
app.use(express.json());

// Start a new export job
app.post('/export', (req, res) => {
  const jobId = uuidv4();
  const outputPath = path.join(JOBS_DIR, `${jobId}.mp4`);

  // Load current jobs
  const jobs = loadJobs();
  jobs[jobId] = { status: 'rendering', outputPath, createdAt: Date.now() };
  saveJobs(jobs);

  // Example FFmpeg command; replace with your actual export logic
  const ffmpegCmd = `ffmpeg -y -i input.mp4 ${outputPath}`;
  const ffmpegProcess = exec(ffmpegCmd, (error) => {
    const jobs = loadJobs();
    if (error) {
      console.error(`Job ${jobId} failed:`, error);
      jobs[jobId].status = 'failed';
    } else {
      jobs[jobId].status = 'completed';
    }
    saveJobs(jobs);
  });

  res.json({ jobId, status: 'rendering' });
});

// Check job status
app.get('/status/:jobId', (req, res) => {
  const jobs = loadJobs();
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status });
});

// Download completed job
app.get('/download/:jobId', (req, res) => {
  const jobs = loadJobs();
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job not completed yet' });
  }

  if (!fs.existsSync(job.outputPath)) {
    return res.status(500).json({ error: 'Output file missing' });
  }

  res.download(job.outputPath, `${req.params.jobId}.mp4`);
});

// Cleanup old failed jobs periodically (optional)
setInterval(() => {
  const jobs = loadJobs();
  for (const [id, job] of Object.entries(jobs)) {
    if (job.status === 'failed' && Date.now() - job.createdAt > 3600 * 1000) {
      if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
      delete jobs[id];
    }
  }
  saveJobs(jobs);
}, 60 * 60 * 1000); // every hour

app.listen(PORT, () => {
  console.log(`Render server listening on port ${PORT}`);
});
