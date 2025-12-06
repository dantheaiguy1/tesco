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

// In-memory job status
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

app.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[Download] ${url}`);
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
        reject(new Error(`Download failed: ${response.statusCode}`));
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
  console.log(`[Vertex] Getting token for ${clientEmail}`);
  
  // Fix private key - handle both escaped and unescaped newlines
  let fixedKey = privateKey;
  if (privateKey.includes('\\n')) {
    fixedKey = privateKey.replace(/\\n/g, '\n');
  }
  
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { 
    iss: clientEmail, 
    sub: clientEmail, 
    aud: 'https://oauth2.googleapis.com/token', 
    iat: now, 
    exp: now + 3600, 
    scope: 'https://www.googleapis.com/auth/cloud-platform' 
  };
  
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = base64url(header) + '.' + base64url(payload);
  
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const sig = sign.sign(fixedKey, 'base64url');
    const jwt = unsigned + '.' + sig;
    
    const res = await fetch('https://oauth2.googleapis.com/token', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` 
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Vertex] Token error: ${errText}`);
      return null;
    }
    
    const data = await res.json();
    console.log(`[Vertex] Token obtained successfully`);
    return data.access_token;
  } catch (e) {
    console.error(`[Vertex] Sign error: ${e.message}`);
    return null;
  }
}

async function generateVeo3(prompt, duration, aspectRatio, creds, jobId, clipIndex, totalClips) {
  console.log(`[Veo3] Starting clip ${clipIndex+1}/${totalClips}: "${prompt.substring(0,50)}..." ${duration}s`);
  
  if (!creds.clientEmail || !creds.privateKey || !creds.projectId) {
    throw new Error('Missing Vertex credentials');
  }
  
  const token = await getVertexToken(creds.clientEmail, creds.privateKey);
  if (!token) throw new Error('Failed to get Vertex token');
  
  // Use stable veo-3.0-generate-001 model instead of preview
  const modelId = 'veo-3.0-generate-001';
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${creds.projectId}/locations/us-central1/publishers/google/models/${modelId}:predictLongRunning`;
  
  console.log(`[Veo3] Calling endpoint: ${endpoint}`);
  
  const startRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { 
        aspectRatio: aspectRatio || '9:16', 
        durationSeconds: duration, 
        sampleCount: 1, 
        generateAudio: false, 
        resolution: '720p' 
      }
    })
  });
  
  if (!startRes.ok) {
    const errText = await startRes.text();
    console.error(`[Veo3] Start failed: ${startRes.status} - ${errText}`);
    throw new Error(`Veo3 start failed: ${startRes.status}`);
  }
  
  const startData = await startRes.json();
  const opName = startData.name;
  console.log(`[Veo3] Operation started: ${opName}`);
  
  // CORRECT polling endpoint: fetchPredictOperation (not generic operations endpoint)
  const pollEndpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${creds.projectId}/locations/us-central1/publishers/google/models/${modelId}:fetchPredictOperation`;
  console.log(`[Veo3] Poll endpoint: ${pollEndpoint}`);
  
  // Poll for completion (up to 10 min)
  for (let i = 0; i < 120; i++) {
    // Update job status with poll progress
    const progress = 10 + (clipIndex * 40 / totalClips) + (i * 40 / (totalClips * 120));
    jobs.set(jobId, { 
      status: 'processing', 
      stage: `veo3_${clipIndex+1}_of_${totalClips}`, 
      progress: Math.round(progress),
      veo3Poll: `${i+1}/120`
    });
    
    await new Promise(r => setTimeout(r, 5000));
    
    try {
      // Use POST with operationName in body (per Google docs)
      const pollRes = await fetch(pollEndpoint, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operationName: opName })
      });
      
      if (!pollRes.ok) {
        const errText = await pollRes.text();
        console.log(`[Veo3] Poll failed: ${pollRes.status} - ${errText}`);
        continue;
      }
      
      const data = await pollRes.json();
      console.log(`[Veo3] Poll response done=${data.done}`);
      
      if (data.done) {
        // Response format: response.videos[].gcsUri (not predictions[].videoUri)
        if (data.response?.videos?.[0]?.gcsUri) {
          const gcsUri = data.response.videos[0].gcsUri;
          console.log(`[Veo3] Complete: ${gcsUri}`);
          
          // Convert GCS URI to downloadable URL
          // gs://bucket/path -> https://storage.googleapis.com/bucket/path
          const httpsUrl = gcsUri.replace('gs://', 'https://storage.googleapis.com/');
          console.log(`[Veo3] HTTPS URL: ${httpsUrl}`);
          return httpsUrl;
        }
        if (data.error) {
          console.error(`[Veo3] Error: ${JSON.stringify(data.error)}`);
          throw new Error(data.error.message || 'Veo3 error');
        }
        // Check for RAI filter
        if (data.response?.raiMediaFilteredCount > 0) {
          console.error(`[Veo3] Video filtered by RAI policies`);
          throw new Error('Video filtered by responsible AI policies');
        }
      }
      
      console.log(`[Veo3] Still processing... poll ${i+1}/120`);
    } catch (pollErr) {
      console.error(`[Veo3] Poll exception: ${pollErr.message}`);
    }
  }
  
  throw new Error('Veo3 timeout after 10 minutes');
}

async function processVideoGeneration(jobId, params) {
  const { veo3Segments, stockClipUrls, motionGraphicUrls, voiceoverUrl, aspectRatio, vertexCredentials } = params;
  const workDir = `/tmp/job-${jobId}`;
  
  console.log(`[Job ${jobId}] Starting...`);
  console.log(`[Job ${jobId}] Veo3 segments: ${veo3Segments?.length || 0}`);
  console.log(`[Job ${jobId}] Stock clips: ${stockClipUrls?.length || 0}`);
  console.log(`[Job ${jobId}] Motion graphics: ${motionGraphicUrls?.length || 0}`);
  console.log(`[Job ${jobId}] Has credentials: ${!!vertexCredentials?.projectId}`);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    jobs.set(jobId, { status: 'processing', stage: 'starting', progress: 0 });
    
    const allClips = [];
    
    // 1. Generate Veo 3 clips
    if (veo3Segments?.length && vertexCredentials?.projectId) {
      console.log(`[Job ${jobId}] Starting Veo 3 generation...`);
      jobs.set(jobId, { status: 'processing', stage: 'veo3', progress: 5 });
      
      for (let i = 0; i < veo3Segments.length; i++) {
        const seg = veo3Segments[i];
        try {
          const veoUrl = await generateVeo3(
            seg.prompt, 
            seg.duration, 
            aspectRatio, 
            vertexCredentials,
            jobId,
            i,
            veo3Segments.length
          );
          
          const clipPath = path.join(workDir, `veo3-${i}.mp4`);
          console.log(`[Job ${jobId}] Downloading Veo3 clip ${i}...`);
          await downloadFile(veoUrl, clipPath);
          allClips.push({ path: clipPath, order: seg.order ?? i });
          console.log(`[Job ${jobId}] Veo3 clip ${i} complete`);
        } catch (e) {
          console.error(`[Job ${jobId}] Veo3 clip ${i} failed: ${e.message}`);
          // Continue with other clips
        }
      }
    } else {
      console.log(`[Job ${jobId}] Skipping Veo3 - no segments or no credentials`);
    }
    
    // 2. Download stock clips
    if (stockClipUrls?.length) {
      jobs.set(jobId, { status: 'processing', stage: 'stock_clips', progress: 50 });
      console.log(`[Job ${jobId}] Downloading ${stockClipUrls.length} stock clips...`);
      
      for (let i = 0; i < stockClipUrls.length; i++) {
        try {
          const clipPath = path.join(workDir, `stock-${i}.mp4`);
          await downloadFile(stockClipUrls[i].url, clipPath);
          allClips.push({ path: clipPath, order: stockClipUrls[i].order ?? (100 + i) });
        } catch (e) {
          console.error(`[Job ${jobId}] Stock clip ${i} failed: ${e.message}`);
        }
      }
    }
    
    // 3. Download motion graphics
    if (motionGraphicUrls?.length) {
      jobs.set(jobId, { status: 'processing', stage: 'motion_graphics', progress: 60 });
      console.log(`[Job ${jobId}] Downloading ${motionGraphicUrls.length} motion graphics...`);
      
      for (let i = 0; i < motionGraphicUrls.length; i++) {
        try {
          const clipPath = path.join(workDir, `motion-${i}.mp4`);
          await downloadFile(motionGraphicUrls[i].url, clipPath);
          allClips.push({ path: clipPath, order: motionGraphicUrls[i].order ?? (200 + i) });
        } catch (e) {
          console.error(`[Job ${jobId}] Motion clip ${i} failed: ${e.message}`);
        }
      }
    }
    
    console.log(`[Job ${jobId}] Total clips: ${allClips.length}`);
    
    if (allClips.length === 0) {
      throw new Error('No clips generated or downloaded');
    }
    
    allClips.sort((a, b) => a.order - b.order);
    jobs.set(jobId, { status: 'processing', stage: 'encoding', progress: 70 });
    
    // 4. Encode clips
    const { execSync } = require('child_process');
    const encodedPaths = [];
    
    for (let i = 0; i < allClips.length; i++) {
      const outPath = path.join(workDir, `enc-${i}.ts`);
      try {
        console.log(`[Job ${jobId}] Encoding clip ${i+1}/${allClips.length}...`);
        execSync(`ffmpeg -i "${allClips[i].path}" -c:v libx264 -c:a aac -bsf:v h264_mp4toannexb -f mpegts -y "${outPath}"`, { 
          stdio: 'pipe', 
          timeout: 120000 
        });
        encodedPaths.push(outPath);
      } catch (e) {
        console.error(`[Job ${jobId}] Encode ${i} failed: ${e.message}`);
      }
    }
    
    if (encodedPaths.length === 0) throw new Error('All encoding failed');
    
    // 5. Concatenate
    jobs.set(jobId, { status: 'processing', stage: 'concatenating', progress: 85 });
    const concatPath = path.join(workDir, 'concat.mp4');
    console.log(`[Job ${jobId}] Concatenating ${encodedPaths.length} clips...`);
    execSync(`ffmpeg -i "concat:${encodedPaths.join('|')}" -c copy -bsf:a aac_adtstoasc -y "${concatPath}"`, { stdio: 'pipe' });
    
    // 6. Add voiceover
    let finalPath = concatPath;
    if (voiceoverUrl) {
      jobs.set(jobId, { status: 'processing', stage: 'adding_voiceover', progress: 90 });
      const voPath = path.join(workDir, 'vo.mp3');
      try {
        console.log(`[Job ${jobId}] Adding voiceover...`);
        await downloadFile(voiceoverUrl, voPath);
        finalPath = path.join(workDir, 'final.mp4');
        execSync(`ffmpeg -i "${concatPath}" -i "${voPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${finalPath}"`, { stdio: 'pipe' });
      } catch (e) {
        console.error(`[Job ${jobId}] Voiceover failed: ${e.message}`);
        finalPath = concatPath;
      }
    }
    
    // 7. Upload
    jobs.set(jobId, { status: 'processing', stage: 'uploading', progress: 95 });
    console.log(`[Job ${jobId}] Uploading to R2...`);
    const videoUrl = await uploadToR2(finalPath, `assembled/${jobId}.mp4`);
    
    fs.rmSync(workDir, { recursive: true, force: true });
    jobs.set(jobId, { status: 'completed', videoUrl, progress: 100 });
    console.log(`[Job ${jobId}] Complete: ${videoUrl}`);
    
  } catch (error) {
    console.error(`[Job ${jobId}] Failed: ${error.message}`);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(e) {}
    jobs.set(jobId, { status: 'failed', error: error.message });
  }
}

// Async video generation - returns immediately
app.post('/generate-video', (req, res) => {
  const jobId = req.body.videoId || `job-${Date.now()}`;
  
  console.log(`[API] Starting job ${jobId}`);
  console.log(`[API] Body keys: ${Object.keys(req.body).join(', ')}`);
  
  jobs.set(jobId, { status: 'queued', progress: 0 });
  processVideoGeneration(jobId, req.body);
  
  res.json({ success: true, jobId, message: 'Job started' });
});

// Simple sync assembly
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
