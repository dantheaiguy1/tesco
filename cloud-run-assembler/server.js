const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;

// In-memory job status (for MVP - use Redis/DB in production)
const jobs = new Map();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'shopshot-videos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-dc7e4f65e1c8497583a99e9ebe196cd3.r2.dev';

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'shopshot-assembler', jobs: jobs.size });
});

// Check job status
app.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Failed: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function uploadToR2(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: fileContent, ContentType: 'video/mp4' }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function getVertexToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: clientEmail, sub: clientEmail, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/cloud-platform' };
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = base64url(header) + '.' + base64url(payload);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const sig = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url');
  const jwt = unsigned + '.' + sig;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  if (!res.ok) return null;
  return (await res.json()).access_token;
}

async function generateVeo3(prompt, duration, aspectRatio, creds) {
  console.log(`[Veo3] Generating: "${prompt.substring(0,40)}..." ${duration}s`);
  const token = await getVertexToken(creds.clientEmail, creds.privateKey);
  if (!token) throw new Error('Auth failed');
  
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${creds.projectId}/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`;
  
  const startRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio, durationSeconds: duration, sampleCount: 1, generateAudio: false, resolution: '720p' }
    })
  });
  
  if (!startRes.ok) throw new Error(`Veo3 start failed: ${startRes.status}`);
  const opName = (await startRes.json()).name;
  console.log(`[Veo3] Operation: ${opName}`);
  
  // Poll for completion (up to 10 min)
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/${opName}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!pollRes.ok) continue;
    const data = await pollRes.json();
    if (data.done) {
      if (data.response?.predictions?.[0]?.videoUri) {
        console.log(`[Veo3] Done: ${data.response.predictions[0].videoUri}`);
        return data.response.predictions[0].videoUri;
      }
      if (data.error) throw new Error(data.error.message);
    }
    console.log(`[Veo3] Waiting... ${i+1}/120`);
  }
  throw new Error('Veo3 timeout');
}

// Process video generation in background
async function processVideoGeneration(jobId, params) {
  const { veo3Segments, stockClipUrls, motionGraphicUrls, voiceoverUrl, aspectRatio, vertexCredentials } = params;
  const workDir = `/tmp/job-${jobId}`;
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    jobs.set(jobId, { status: 'processing', stage: 'starting', progress: 0 });
    
    const allClips = [];
    
    // 1. Generate Veo 3 clips (DISABLED FOR NOW - takes too long and blocks)
    // TODO: Re-enable when we have proper async Veo 3 handling
    if (veo3Segments?.length && vertexCredentials && false) { // Disabled
      jobs.set(jobId, { status: 'processing', stage: 'veo3', progress: 10 });
      for (let i = 0; i < veo3Segments.length; i++) {
        const seg = veo3Segments[i];
        try {
          jobs.set(jobId, { status: 'processing', stage: `veo3_${i+1}_of_${veo3Segments.length}`, progress: 10 + (i * 30 / veo3Segments.length) });
          const veoUrl = await generateVeo3(seg.prompt, seg.duration, aspectRatio || '9:16', vertexCredentials);
          const clipPath = path.join(workDir, `veo3-${i}.mp4`);
          await downloadFile(veoUrl, clipPath);
          allClips.push({ path: clipPath, order: seg.order || i });
        } catch (e) {
          console.error(`Veo3 clip ${i} failed:`, e.message);
        }
      }
    } else if (veo3Segments?.length) {
      // Use placeholder for Veo 3 segments for now
      console.log(`[Generate] Skipping ${veo3Segments.length} Veo3 segments (using stock/motion only)`);
    }
    
    // 2. Download stock clips
    if (stockClipUrls?.length) {
      jobs.set(jobId, { status: 'processing', stage: 'stock_clips', progress: 50 });
      for (let i = 0; i < stockClipUrls.length; i++) {
        try {
          const clipPath = path.join(workDir, `stock-${i}.mp4`);
          await downloadFile(stockClipUrls[i].url, clipPath);
          allClips.push({ path: clipPath, order: stockClipUrls[i].order || 100 + i });
        } catch (e) {
          console.error(`Stock clip ${i} failed:`, e.message);
        }
      }
    }
    
    // 3. Download motion graphics
    if (motionGraphicUrls?.length) {
      jobs.set(jobId, { status: 'processing', stage: 'motion_graphics', progress: 60 });
      for (let i = 0; i < motionGraphicUrls.length; i++) {
        try {
          const clipPath = path.join(workDir, `motion-${i}.mp4`);
          await downloadFile(motionGraphicUrls[i].url, clipPath);
          allClips.push({ path: clipPath, order: motionGraphicUrls[i].order || 200 + i });
        } catch (e) {
          console.error(`Motion clip ${i} failed:`, e.message);
        }
      }
    }
    
    if (allClips.length === 0) {
      throw new Error('No clips generated');
    }
    
    allClips.sort((a, b) => a.order - b.order);
    jobs.set(jobId, { status: 'processing', stage: 'encoding', progress: 70 });
    
    // 4. Encode clips
    const { execSync } = require('child_process');
    const encodedPaths = [];
    for (let i = 0; i < allClips.length; i++) {
      const outPath = path.join(workDir, `enc-${i}.ts`);
      try {
        execSync(`ffmpeg -i "${allClips[i].path}" -c:v libx264 -c:a aac -bsf:v h264_mp4toannexb -f mpegts -y "${outPath}"`, { stdio: 'pipe', timeout: 120000 });
        encodedPaths.push(outPath);
      } catch (e) {
        console.error(`Encode ${i} failed`);
      }
    }
    
    if (encodedPaths.length === 0) throw new Error('Encoding failed');
    
    // 5. Concatenate
    jobs.set(jobId, { status: 'processing', stage: 'concatenating', progress: 85 });
    const concatPath = path.join(workDir, 'concat.mp4');
    execSync(`ffmpeg -i "concat:${encodedPaths.join('|')}" -c copy -bsf:a aac_adtstoasc -y "${concatPath}"`, { stdio: 'pipe' });
    
    // 6. Add voiceover
    let finalPath = concatPath;
    if (voiceoverUrl) {
      jobs.set(jobId, { status: 'processing', stage: 'adding_voiceover', progress: 90 });
      const voPath = path.join(workDir, 'vo.mp3');
      try {
        await downloadFile(voiceoverUrl, voPath);
        finalPath = path.join(workDir, 'final.mp4');
        execSync(`ffmpeg -i "${concatPath}" -i "${voPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${finalPath}"`, { stdio: 'pipe' });
      } catch (e) {
        console.error('Voiceover failed:', e.message);
      }
    }
    
    // 7. Upload
    jobs.set(jobId, { status: 'processing', stage: 'uploading', progress: 95 });
    const videoUrl = await uploadToR2(finalPath, `assembled/${jobId}.mp4`);
    
    fs.rmSync(workDir, { recursive: true, force: true });
    jobs.set(jobId, { status: 'completed', videoUrl, progress: 100 });
    console.log(`[Job ${jobId}] Complete: ${videoUrl}`);
    
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error.message);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(e) {}
    jobs.set(jobId, { status: 'failed', error: error.message });
  }
}

// Start async video generation - returns immediately
app.post('/generate-video', (req, res) => {
  const jobId = req.body.videoId || `job-${Date.now()}`;
  
  // Start processing in background
  jobs.set(jobId, { status: 'queued', progress: 0 });
  processVideoGeneration(jobId, req.body);
  
  // Return immediately with job ID
  res.json({ success: true, jobId, message: 'Video generation started. Poll /job/:jobId for status.' });
});

// Simple sync assembly (for backwards compat)
app.post('/assemble', async (req, res) => {
  const { clips, voiceover, videoId } = req.body;
  const workDir = `/tmp/asm-${Date.now()}`;
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const { execSync } = require('child_process');
    const clipPaths = [];
    
    for (let i = 0; i < clips.length; i++) {
      const raw = path.join(workDir, `raw-${i}.mp4`);
      const enc = path.join(workDir, `enc-${i}.ts`);
      await downloadFile(clips[i], raw);
      execSync(`ffmpeg -i "${raw}" -c:v libx264 -c:a aac -bsf:v h264_mp4toannexb -f mpegts -y "${enc}"`, { stdio: 'pipe' });
      clipPaths.push(enc);
    }
    
    const concat = path.join(workDir, 'concat.mp4');
    execSync(`ffmpeg -i "concat:${clipPaths.join('|')}" -c copy -bsf:a aac_adtstoasc -y "${concat}"`, { stdio: 'pipe' });
    
    let final = concat;
    if (voiceover) {
      const vo = path.join(workDir, 'vo.mp3');
      await downloadFile(voiceover, vo);
      final = path.join(workDir, 'final.mp4');
      execSync(`ffmpeg -i "${concat}" -i "${vo}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${final}"`, { stdio: 'pipe' });
    }
    
    const url = await uploadToR2(final, `assembled/${videoId}-${Date.now()}.mp4`);
    fs.rmSync(workDir, { recursive: true, force: true });
    res.json({ success: true, videoUrl: url });
  } catch (e) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(x) {}
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`ShopShot Assembler on port ${PORT}`));
