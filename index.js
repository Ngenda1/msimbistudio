import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for Lovable frontend
app.use(cors({
  origin: 'https://5eec7204-b4c9-4ca7-9bf5-b31dde9c31ef.lovableproject.com', // Lovable origin
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Store jobs in memory for demo purposes (can use DB for production)
const jobs = {};

// POST /render - receive timeline and start export
app.post('/render', (req, res) => {
  const jobId = uuidv4();
  const timeline = req.body.timeline;

  if (!timeline) {
    return res.status(400).json({ error: 'No timeline provided' });
  }

  jobs[jobId] = { status: 'rendering', timeline, output: null, createdAt: Date.now() };
  console.log(`Started job ${jobId} with timeline`);

  // Simulate export process (replace with actual FFmpeg logic)
  const outputDir = path.join(process.cwd(), 'jobs', jobId);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'output.mp4');

  // Simulate async export
  setTimeout(() => {
    fs.writeFileSync(outputFile, 'FAKE_VIDEO_CONTENT'); // Replace with real video generation
    jobs[jobId].status = 'completed';
    jobs[jobId].output = outputFile;
    console.log(`Job ${jobId} completed`);
  }, 5000); // simulate 5 seconds export

  res.json({ jobId, status: 'rendering' });
});

// GET /status/:jobId - check status of a job
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ jobId, status: job.status });
});

// GET /download/:jobId - download the exported video
app.get('/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job not completed yet' });
  }

  res.download(job.output, 'export.mp4', (err) => {
    if (err) console.error(`Error sending file for job ${jobId}:`, err);
  });
});

// Health check
app.get('/', (req, res) => {
  res.send('Render server is running');
});

app.listen(PORT, () => {
  console.log(`🎬 Render server listening on port ${PORT}`);
});

