const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;
const TMP_DIR = '/tmp';

// Google Cloud Storage client
const storage = new Storage();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Download file from URL to local path
async function downloadFile(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });
  
  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', reject);
  });
}

// Upload file to Google Cloud Storage
async function uploadToGCS(localPath, bucketName, destPath) {
  const bucket = storage.bucket(bucketName);
  await bucket.upload(localPath, {
    destination: destPath,
    metadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000'
    }
  });
  
  // Make public
  await bucket.file(destPath).makePublic();
  
  return `https://storage.googleapis.com/${bucketName}/${destPath}`;
}

// Main video assembly endpoint
app.post('/assemble', async (req, res) => {
  const { clips, audioUrl, captionsSrt, videoId, outputBucket } = req.body;
  
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
    
    // 1. Download all video clips
    const clipPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const clipPath = path.join(workDir, `clip_${i}.mp4`);
      console.log(`Downloading clip ${i + 1}/${clips.length}: ${clips[i]}`);
      await downloadFile(clips[i], clipPath);
      clipPaths.push(clipPath);
    }
    
    // 2. Download audio if provided
    let audioPath = null;
    if (audioUrl) {
      audioPath = path.join(workDir, 'audio.mp3');
      console.log('Downloading audio...');
      await downloadFile(audioUrl, audioPath);
    }
    
    // 3. Save captions SRT if provided
    let captionsPath = null;
    if (captionsSrt) {
      captionsPath = path.join(workDir, 'captions.srt');
      fs.writeFileSync(captionsPath, captionsSrt);
    }
    
    // 4. Create concat file for FFmpeg
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = clipPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);
    
    // 5. Assemble video with FFmpeg
    const outputPath = path.join(workDir, 'final.mp4');
    
    await new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0']);
      
      // Add audio if provided
      if (audioPath) {
        command = command.input(audioPath);
      }
      
      // Build filter complex for captions
      const filters = [];
      if (captionsPath) {
        // TikTok-style captions: big, bold, center screen
        const subtitleFilter = `subtitles='${captionsPath}':force_style='FontName=Montserrat-Bold,FontSize=32,PrimaryColour=&HFFFFFF&,Outline=3,OutlineColour=&H000000&,Alignment=5,MarginV=50'`;
        filters.push(subtitleFilter);
      }
      
      if (filters.length > 0) {
        command = command.videoFilters(filters);
      }
      
      command
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          '-shortest'
        ])
        .on('start', (cmd) => {
          console.log('FFmpeg started:', cmd);
        })
        .on('progress', (progress) => {
          console.log(`Processing: ${progress.percent?.toFixed(1)}%`);
        })
        .on('end', () => {
          console.log('FFmpeg finished successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .save(outputPath);
    });
    
    // 6. Upload to Cloud Storage
    let videoUrl;
    const destPath = `videos/final_${jobId}.mp4`;
    
    if (outputBucket) {
      videoUrl = await uploadToGCS(outputPath, outputBucket, destPath);
      console.log(`Uploaded to: ${videoUrl}`);
    } else {
      // Return as base64 if no bucket specified (for testing)
      const videoBuffer = fs.readFileSync(outputPath);
      videoUrl = `data:video/mp4;base64,${videoBuffer.toString('base64').substring(0, 100)}...`;
    }
    
    // 7. Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    
    res.json({
      success: true,
      videoUrl,
      jobId,
      stats: {
        clipsProcessed: clips.length,
        hasAudio: !!audioUrl,
        hasCaptions: !!captionsSrt
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

// Simple concatenation endpoint (no audio/captions)
app.post('/concat', async (req, res) => {
  const { clips, videoId, outputBucket } = req.body;
  
  if (!clips || !clips.length) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  
  const jobId = videoId || `concat_${Date.now()}`;
  const workDir = path.join(TMP_DIR, jobId);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    // Download clips
    const clipPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const clipPath = path.join(workDir, `clip_${i}.mp4`);
      await downloadFile(clips[i], clipPath);
      clipPaths.push(clipPath);
    }
    
    // Create concat list
    const concatListPath = path.join(workDir, 'concat_list.txt');
    fs.writeFileSync(concatListPath, clipPaths.map(p => `file '${p}'`).join('\n'));
    
    // Simple concat
    const outputPath = path.join(workDir, 'output.mp4');
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
    
    let videoUrl;
    if (outputBucket) {
      videoUrl = await uploadToGCS(outputPath, outputBucket, `videos/concat_${jobId}.mp4`);
    } else {
      videoUrl = 'local://' + outputPath;
    }
    
    fs.rmSync(workDir, { recursive: true, force: true });
    
    res.json({ success: true, videoUrl, jobId });
    
  } catch (error) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    res.status(500).json({ error: error.message, jobId });
  }
});

// Add captions to existing video
app.post('/add-captions', async (req, res) => {
  const { videoUrl, captionsSrt, videoId, outputBucket } = req.body;
  
  if (!videoUrl || !captionsSrt) {
    return res.status(400).json({ error: 'videoUrl and captionsSrt required' });
  }
  
  const jobId = videoId || `captions_${Date.now()}`;
  const workDir = path.join(TMP_DIR, jobId);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    const inputPath = path.join(workDir, 'input.mp4');
    const captionsPath = path.join(workDir, 'captions.srt');
    const outputPath = path.join(workDir, 'output.mp4');
    
    await downloadFile(videoUrl, inputPath);
    fs.writeFileSync(captionsPath, captionsSrt);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(`subtitles='${captionsPath}':force_style='FontName=Montserrat-Bold,FontSize=32,PrimaryColour=&HFFFFFF&,Outline=3,OutlineColour=&H000000&,Alignment=5,MarginV=50'`)
        .outputOptions(['-c:a', 'copy'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
    
    let resultUrl;
    if (outputBucket) {
      resultUrl = await uploadToGCS(outputPath, outputBucket, `videos/captioned_${jobId}.mp4`);
    } else {
      resultUrl = 'local://' + outputPath;
    }
    
    fs.rmSync(workDir, { recursive: true, force: true });
    
    res.json({ success: true, videoUrl: resultUrl, jobId });
    
  } catch (error) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    res.status(500).json({ error: error.message, jobId });
  }
});

app.listen(PORT, () => {
  console.log(`ShopShot Video Assembler running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /assemble - Full video assembly with audio and captions');
  console.log('  POST /concat - Simple video concatenation');
  console.log('  POST /add-captions - Add captions to existing video');
  console.log('  GET /health - Health check');
});
