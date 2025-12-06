const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;
const TMP_DIR = '/tmp';

// R2 configuration from environment
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'shopshot-videos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-dc7e4f65e1c8497583a99e9ebe196cd3.r2.dev';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    r2Configured: !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
  });
});

// Download file from URL to local path
async function downloadFile(url, outputPath) {
  // Skip placeholder URLs
  if (url.includes('placeholder') || url.startsWith('pending:')) {
    console.log(`Skipping placeholder/pending URL: ${url}`);
    return null;
  }
  
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 60000 // 60 second timeout
  });
  
  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', reject);
  });
}

// Upload file to Cloudflare R2 using S3-compatible API
async function uploadToR2(localPath, destPath) {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.log('R2 not configured, returning local path');
    return `local://${localPath}`;
  }
  
  const AWS = require('aws-sdk');
  
  const s3 = new AWS.S3({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
    region: 'auto'
  });
  
  const fileBuffer = fs.readFileSync(localPath);
  
  await s3.putObject({
    Bucket: R2_BUCKET_NAME,
    Key: destPath,
    Body: fileBuffer,
    ContentType: 'video/mp4'
  }).promise();
  
  return `${R2_PUBLIC_URL}/${destPath}`;
}

// Main video assembly endpoint
app.post('/assemble', async (req, res) => {
  const { clips, audioUrl, captionsSrt, videoId } = req.body;
  
  if (!clips || !clips.length) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  
  const jobId = videoId || `job_${Date.now()}`;
  const workDir = path.join(TMP_DIR, jobId);
  
  try {
    // Create work directory
    fs.mkdirSync(workDir, { recursive: true });
    
    console.log(`Starting assembly job: ${jobId}`);
    console.log(`Clips: ${clips.length}, Audio: ${!!audioUrl}, Captions: ${!!captionsSrt}`);
    
    // 1. Download all video clips (skip placeholders)
    const clipPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const clipUrl = clips[i];
      
      // Skip placeholders and pending clips
      if (clipUrl.includes('placeholder') || clipUrl.startsWith('pending:')) {
        console.log(`Skipping placeholder/pending clip ${i + 1}`);
        continue;
      }
      
      const clipPath = path.join(workDir, `clip_${i}.mp4`);
      console.log(`Downloading clip ${i + 1}/${clips.length}: ${clipUrl.substring(0, 80)}...`);
      
      try {
        await downloadFile(clipUrl, clipPath);
        clipPaths.push(clipPath);
      } catch (dlError) {
        console.error(`Failed to download clip ${i + 1}:`, dlError.message);
      }
    }
    
    if (clipPaths.length === 0) {
      throw new Error('No valid clips to assemble (all were placeholders or failed to download)');
    }
    
    console.log(`Downloaded ${clipPaths.length} valid clips`);
    
    // 2. Download audio if provided
    let audioPath = null;
    if (audioUrl && !audioUrl.includes('placeholder')) {
      audioPath = path.join(workDir, 'audio.mp3');
      console.log('Downloading audio...');
      try {
        await downloadFile(audioUrl, audioPath);
      } catch (audioErr) {
        console.error('Failed to download audio:', audioErr.message);
        audioPath = null;
      }
    }
    
    // 3. Save captions SRT if provided
    let captionsPath = null;
    if (captionsSrt && captionsSrt.trim()) {
      captionsPath = path.join(workDir, 'captions.srt');
      fs.writeFileSync(captionsPath, captionsSrt);
      console.log('Captions saved');
    }
    
    // 4. Normalize all clips to same format first
    const normalizedPaths = [];
    for (let i = 0; i < clipPaths.length; i++) {
      const normalizedPath = path.join(workDir, `normalized_${i}.mp4`);
      console.log(`Normalizing clip ${i + 1}/${clipPaths.length}...`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(clipPaths[i])
          .outputOptions([
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-r', '30', // 30fps
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2'
          ])
          .on('end', () => {
            normalizedPaths.push(normalizedPath);
            resolve();
          })
          .on('error', (err) => {
            console.error(`Normalize error for clip ${i}:`, err.message);
            // Try to use original if normalize fails
            normalizedPaths.push(clipPaths[i]);
            resolve();
          })
          .save(normalizedPath);
      });
    }
    
    // 5. Create concat file for FFmpeg
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = normalizedPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);
    
    // 6. Concatenate clips
    const concatenatedPath = path.join(workDir, 'concatenated.mp4');
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .on('start', (cmd) => console.log('Concat started'))
        .on('end', () => {
          console.log('Concatenation complete');
          resolve();
        })
        .on('error', reject)
        .save(concatenatedPath);
    });
    
    // 7. Add audio and captions
    const outputPath = path.join(workDir, 'final.mp4');
    
    await new Promise((resolve, reject) => {
      let command = ffmpeg(concatenatedPath);
      
      // Add audio if available
      if (audioPath && fs.existsSync(audioPath)) {
        command = command.input(audioPath);
      }
      
      // Build output options
      const outputOptions = [
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-shortest'
      ];
      
      // Add captions filter if available
      if (captionsPath && fs.existsSync(captionsPath)) {
        command = command.videoFilters([
          `subtitles='${captionsPath}':force_style='FontName=Arial,FontSize=28,PrimaryColour=&HFFFFFF&,Outline=2,OutlineColour=&H000000&,Alignment=2,MarginV=40'`
        ]);
      }
      
      // Mix audio if we have both video audio and voiceover
      if (audioPath && fs.existsSync(audioPath)) {
        command = command.outputOptions([
          '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=shortest[aout]',
          '-map', '0:v',
          '-map', '[aout]'
        ]);
      }
      
      command
        .outputOptions(outputOptions)
        .on('start', (cmd) => console.log('Final assembly started'))
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Processing: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('Final assembly complete');
          resolve();
        })
        .on('error', (err) => {
          console.error('Assembly error:', err.message);
          // If complex assembly fails, try simple copy
          ffmpeg(concatenatedPath)
            .outputOptions(['-c', 'copy'])
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
        })
        .save(outputPath);
    });
    
    // 8. Upload to R2
    const destPath = `assembled/${jobId}.mp4`;
    console.log('Uploading to R2...');
    const videoUrl = await uploadToR2(outputPath, destPath);
    console.log(`Uploaded: ${videoUrl}`);
    
    // 9. Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    
    res.json({
      success: true,
      videoUrl,
      jobId,
      stats: {
        clipsProcessed: clipPaths.length,
        hasAudio: !!audioPath,
        hasCaptions: !!captionsPath
      }
    });
    
  } catch (error) {
    console.error('Assembly error:', error);
    
    // Cleanup on error
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {}
    
    res.status(500).json({
      error: error.message,
      jobId
    });
  }
});

// Simple test endpoint
app.post('/test', async (req, res) => {
  const { videoUrl } = req.body;
  
  try {
    // Just try to download and return info
    const response = await axios.head(videoUrl, { timeout: 10000 });
    res.json({
      success: true,
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length']
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ShopShot Video Assembler running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /assemble - Full video assembly with audio and captions');
  console.log('  POST /test - Test video URL accessibility');
  console.log('  GET /health - Health check');
  console.log('');
  console.log('Environment:');
  console.log(`  R2 configured: ${!!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID)}`);
  console.log(`  R2 bucket: ${R2_BUCKET_NAME}`);
});
