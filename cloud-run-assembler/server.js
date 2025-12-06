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

// R2 Configuration
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

// Vertex AI credentials (passed per-request or from env)
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID;
const VERTEX_CLIENT_EMAIL = process.env.VERTEX_CLIENT_EMAIL;
const VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY;

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'shopshot-assembler', timestamp: new Date().toISOString() });
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
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function uploadToR2(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: 'video/mp4'
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Get Vertex AI access token
async function getVertexAccessToken(clientEmail, privateKey) {
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
  const unsignedToken = base64url(header) + '.' + base64url(payload);

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url');
  const jwt = unsignedToken + '.' + signature;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text());
    return null;
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Generate Veo 3 clip and WAIT for completion (no timeout here!)
async function generateVeo3Clip(prompt, duration, aspectRatio, credentials) {
  const { projectId, clientEmail, privateKey } = credentials;
  
  console.log(`[Veo3] Starting generation: "${prompt.substring(0, 50)}..." (${duration}s)`);
  
  const accessToken = await getVertexAccessToken(clientEmail, privateKey);
  if (!accessToken) {
    throw new Error('Failed to get Vertex AI access token');
  }

  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`;

  // Start the operation
  const startRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio: aspectRatio,
        durationSeconds: duration,
        sampleCount: 1,
        generateAudio: false,
        resolution: '720p'
      }
    })
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    console.error('[Veo3] Start failed:', err);
    throw new Error(`Veo3 start failed: ${startRes.status}`);
  }

  const startData = await startRes.json();
  const operationName = startData.name;
  console.log(`[Veo3] Operation started: ${operationName}`);

  // Poll for completion - NO TIMEOUT LIMIT HERE
  const pollUrl = `https://us-central1-aiplatform.googleapis.com/v1/${operationName}`;
  const maxAttempts = 120; // 10 minutes max (5s intervals)
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds
    
    const pollRes = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!pollRes.ok) {
      console.error('[Veo3] Poll failed:', pollRes.status);
      continue;
    }
    
    const pollData = await pollRes.json();
    
    if (pollData.done) {
      if (pollData.response?.predictions?.[0]?.videoUri) {
        const videoUri = pollData.response.predictions[0].videoUri;
        console.log(`[Veo3] Complete! URI: ${videoUri}`);
        return videoUri;
      } else if (pollData.error) {
        throw new Error(`Veo3 error: ${pollData.error.message}`);
      }
    }
    
    console.log(`[Veo3] Still processing... (${i + 1}/${maxAttempts})`);
  }
  
  throw new Error('Veo3 generation timed out after 10 minutes');
}

// NEW: Full video generation endpoint with Veo 3
app.post('/generate-video', async (req, res) => {
  const { 
    veo3Segments, // Array of { prompt, duration }
    stockClipUrls, // Array of URLs
    motionGraphicUrls, // Array of URLs
    voiceoverUrl,
    aspectRatio,
    videoId,
    vertexCredentials // { projectId, clientEmail, privateKey }
  } = req.body;

  const workDir = `/tmp/gen-${Date.now()}`;
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`[Generate] Starting full generation for ${videoId}`);
    console.log(`[Generate] Veo3 segments: ${veo3Segments?.length || 0}`);
    console.log(`[Generate] Stock clips: ${stockClipUrls?.length || 0}`);
    console.log(`[Generate] Motion graphics: ${motionGraphicUrls?.length || 0}`);

    const allClipPaths = [];

    // 1. Generate Veo 3 clips (this can take minutes - that's fine here!)
    if (veo3Segments && veo3Segments.length > 0 && vertexCredentials) {
      console.log('[Generate] Generating Veo 3 clips...');
      
      for (let i = 0; i < veo3Segments.length; i++) {
        const seg = veo3Segments[i];
        try {
          const veoUrl = await generateVeo3Clip(
            seg.prompt,
            seg.duration,
            aspectRatio || '9:16',
            vertexCredentials
          );
          
          // Download the generated video
          const clipPath = path.join(workDir, `veo3-${i}.mp4`);
          await downloadFile(veoUrl, clipPath);
          allClipPaths.push({ path: clipPath, order: seg.order || i });
          console.log(`[Generate] Veo3 clip ${i + 1} complete`);
        } catch (veoErr) {
          console.error(`[Generate] Veo3 clip ${i} failed:`, veoErr.message);
          // Continue with other clips
        }
      }
    }

    // 2. Download stock clips
    if (stockClipUrls && stockClipUrls.length > 0) {
      for (let i = 0; i < stockClipUrls.length; i++) {
        const clipPath = path.join(workDir, `stock-${i}.mp4`);
        try {
          await downloadFile(stockClipUrls[i].url, clipPath);
          allClipPaths.push({ path: clipPath, order: stockClipUrls[i].order || 100 + i });
        } catch (e) {
          console.error(`[Generate] Stock clip ${i} failed:`, e.message);
        }
      }
    }

    // 3. Download motion graphics
    if (motionGraphicUrls && motionGraphicUrls.length > 0) {
      for (let i = 0; i < motionGraphicUrls.length; i++) {
        const clipPath = path.join(workDir, `motion-${i}.mp4`);
        try {
          await downloadFile(motionGraphicUrls[i].url, clipPath);
          allClipPaths.push({ path: clipPath, order: motionGraphicUrls[i].order || 200 + i });
        } catch (e) {
          console.error(`[Generate] Motion graphic ${i} failed:`, e.message);
        }
      }
    }

    if (allClipPaths.length === 0) {
      throw new Error('No clips were generated or downloaded');
    }

    // Sort by order
    allClipPaths.sort((a, b) => a.order - b.order);
    console.log(`[Generate] Total clips to assemble: ${allClipPaths.length}`);

    // 4. Download voiceover
    let voiceoverPath = null;
    if (voiceoverUrl) {
      voiceoverPath = path.join(workDir, 'voiceover.mp3');
      try {
        await downloadFile(voiceoverUrl, voiceoverPath);
        console.log('[Generate] Voiceover downloaded');
      } catch (e) {
        console.error('[Generate] Voiceover download failed:', e.message);
        voiceoverPath = null;
      }
    }

    // 5. Re-encode clips to consistent format
    const { execSync } = require('child_process');
    const encodedPaths = [];
    
    for (let i = 0; i < allClipPaths.length; i++) {
      const inPath = allClipPaths[i].path;
      const outPath = path.join(workDir, `encoded-${i}.ts`);
      
      try {
        execSync(`ffmpeg -i "${inPath}" -c:v libx264 -c:a aac -bsf:v h264_mp4toannexb -f mpegts -y "${outPath}"`, {
          stdio: 'pipe',
          timeout: 120000 // 2 min per clip
        });
        encodedPaths.push(outPath);
        console.log(`[Generate] Encoded clip ${i + 1}/${allClipPaths.length}`);
      } catch (e) {
        console.error(`[Generate] Encode failed for clip ${i}:`, e.message);
      }
    }

    if (encodedPaths.length === 0) {
      throw new Error('All clip encoding failed');
    }

    // 6. Concatenate
    const concatInput = 'concat:' + encodedPaths.join('|');
    const concatPath = path.join(workDir, 'concat.mp4');
    
    execSync(`ffmpeg -i "${concatInput}" -c copy -bsf:a aac_adtstoasc -y "${concatPath}"`, {
      stdio: 'pipe',
      timeout: 60000
    });
    console.log('[Generate] Clips concatenated');

    // 7. Add voiceover
    let finalPath = concatPath;
    if (voiceoverPath && fs.existsSync(voiceoverPath)) {
      finalPath = path.join(workDir, 'final.mp4');
      execSync(`ffmpeg -i "${concatPath}" -i "${voiceoverPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${finalPath}"`, {
        stdio: 'pipe',
        timeout: 60000
      });
      console.log('[Generate] Voiceover added');
    }

    // 8. Upload to R2
    const outputKey = `assembled/${videoId}-${Date.now()}.mp4`;
    const publicUrl = await uploadToR2(finalPath, outputKey);
    console.log(`[Generate] Uploaded: ${publicUrl}`);

    // Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });

    res.json({ 
      success: true, 
      videoUrl: publicUrl,
      stats: {
        veo3Clips: veo3Segments?.length || 0,
        stockClips: stockClipUrls?.length || 0,
        motionGraphics: motionGraphicUrls?.length || 0,
        totalClips: allClipPaths.length
      }
    });

  } catch (error) {
    console.error('[Generate] Error:', error);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(e) {}
    res.status(500).json({ success: false, error: error.message });
  }
});

// Keep the simple assemble endpoint for backwards compatibility
app.post('/assemble', async (req, res) => {
  const { clips, voiceover, captions, videoId } = req.body;
  const workDir = `/tmp/assembly-${Date.now()}`;
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`Starting assembly for video ${videoId}, clips: ${clips.length}`);
    
    const { execSync } = require('child_process');
    const clipPaths = [];
    
    for (let i = 0; i < clips.length; i++) {
      const rawPath = path.join(workDir, `raw-${i}.mp4`);
      const clipPath = path.join(workDir, `clip-${i}.ts`);
      console.log(`Downloading clip ${i}: ${clips[i]}`);
      await downloadFile(clips[i], rawPath);
      
      execSync(`ffmpeg -i "${rawPath}" -c:v libx264 -c:a aac -bsf:v h264_mp4toannexb -f mpegts -y "${clipPath}"`, { stdio: 'pipe' });
      clipPaths.push(clipPath);
    }
    
    const concatInput = 'concat:' + clipPaths.join('|');
    const concatOutput = path.join(workDir, 'concat.mp4');
    execSync(`ffmpeg -i "${concatInput}" -c copy -bsf:a aac_adtstoasc -y "${concatOutput}"`, { stdio: 'pipe' });
    
    let finalPath = concatOutput;
    if (voiceover) {
      const voiceoverPath = path.join(workDir, 'voiceover.mp3');
      await downloadFile(voiceover, voiceoverPath);
      finalPath = path.join(workDir, 'final.mp4');
      execSync(`ffmpeg -i "${concatOutput}" -i "${voiceoverPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${finalPath}"`, { stdio: 'pipe' });
    }
    
    const outputKey = `assembled/${videoId}-${Date.now()}.mp4`;
    const publicUrl = await uploadToR2(finalPath, outputKey);
    
    fs.rmSync(workDir, { recursive: true, force: true });
    res.json({ success: true, videoUrl: publicUrl });
  } catch (error) {
    console.error('Assembly error:', error);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(e) {}
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ShopShot Video Assembler running on port ${PORT}`);
});
