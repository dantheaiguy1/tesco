# ShopShot Video Assembler

FFmpeg-powered video assembly service for the ShopShot AI Video Marketing System.

## Features

- **Full Assembly**: Concatenate clips, add voiceover audio, burn in captions
- **Simple Concat**: Quick video concatenation without re-encoding
- **Add Captions**: Burn SRT captions into existing videos

## Deployment to Google Cloud Run

### Prerequisites

1. Google Cloud project with billing enabled
2. Cloud Run API enabled
3. Cloud Storage bucket for output videos

### Deploy

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Build and deploy
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/shopshot-video-assembler

gcloud run deploy shopshot-video-assembler \
  --image gcr.io/YOUR_PROJECT_ID/shopshot-video-assembler \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --timeout 600s \
  --cpu 2
```

### Environment Variables

Set these in Cloud Run or locally:

- `PORT`: Server port (default: 8080)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account JSON (auto-set in Cloud Run)

## API Endpoints

### POST /assemble

Full video assembly with audio and captions.

```json
{
  "clips": ["https://...", "https://..."],
  "audioUrl": "https://...",
  "captionsSrt": "1\n00:00:00,000 --> 00:00:02,000\nCaption text\n\n...",
  "videoId": "vid_123",
  "outputBucket": "shopshot-social-media"
}
```

Response:
```json
{
  "success": true,
  "videoUrl": "https://storage.googleapis.com/...",
  "jobId": "vid_123",
  "stats": {
    "clipsProcessed": 5,
    "hasAudio": true,
    "hasCaptions": true
  }
}
```

### POST /concat

Simple concatenation (no re-encoding).

```json
{
  "clips": ["https://...", "https://..."],
  "videoId": "concat_123",
  "outputBucket": "shopshot-social-media"
}
```

### POST /add-captions

Add captions to existing video.

```json
{
  "videoUrl": "https://...",
  "captionsSrt": "1\n00:00:00,000 --> ...",
  "videoId": "cap_123",
  "outputBucket": "shopshot-social-media"
}
```

### GET /health

Health check endpoint.

## Local Development

```bash
npm install
npm run dev
```

Test with:
```bash
curl http://localhost:8080/health
```

## Caption Styling

Captions are styled TikTok-style:
- Font: Montserrat Bold, 32px
- Color: White with black outline
- Position: Center bottom
- Margin: 50px from bottom

## Cost Estimate

- Cloud Run: ~$0.05 per video (2-3 minutes processing)
- Scales to zero when not in use
