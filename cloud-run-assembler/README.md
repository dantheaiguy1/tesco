# ShopShot Video Assembler - Cloud Run Deployment

## Quick Deploy via Cloud Console

### Step 1: Create R2 API Token
1. Go to Cloudflare Dashboard > R2 > Manage R2 API Tokens
2. Create token with **Object Read & Write** permissions for `shopshot-videos` bucket
3. Save the **Access Key ID** and **Secret Access Key**

### Step 2: Get Your R2 Account ID
1. Go to Cloudflare Dashboard > R2
2. Copy your Account ID from the URL or sidebar

### Step 3: Deploy to Cloud Run
1. Go to: https://console.cloud.google.com/run
2. Click **"Create Service"**
3. Select **"Continuously deploy from a repository"** OR **"Deploy one revision from an existing container image"**

#### Option A: Deploy from Source (Easiest)
1. Click **"Set up with Cloud Build"**
2. Connect your GitHub repo
3. Select branch: `main`
4. Build Type: **Dockerfile**
5. Source location: `/cloud-run-assembler`

#### Option B: Build and Deploy Manually
```bash
# In cloud-run-assembler directory
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/shopshot-assembler
gcloud run deploy shopshot-assembler \
  --image gcr.io/YOUR_PROJECT_ID/shopshot-assembler \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars "R2_ACCOUNT_ID=YOUR_CF_ACCOUNT_ID,R2_BUCKET_NAME=shopshot-videos,R2_PUBLIC_URL=https://pub-dc7e4f65e1c8497583a99e9ebe196cd3.r2.dev"
```

### Step 4: Set Environment Variables
In Cloud Run service settings, add these environment variables:

| Variable | Value |
|----------|-------|
| `R2_ACCOUNT_ID` | Your Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret |
| `R2_BUCKET_NAME` | `shopshot-videos` |
| `R2_PUBLIC_URL` | `https://pub-dc7e4f65e1c8497583a99e9ebe196cd3.r2.dev` |

### Step 5: Configure Service Settings
- **Memory**: 2 GB (minimum for video processing)
- **CPU**: 2 vCPUs
- **Timeout**: 300 seconds (5 minutes)
- **Max instances**: 10
- **Min instances**: 0 (scale to zero when idle)
- **Allow unauthenticated invocations**: Yes

### Step 6: Get Service URL
After deployment, copy the service URL (e.g., `https://shopshot-assembler-xxxxx-uc.a.run.app`)

### Step 7: Add to Cloudflare Pages Secrets
```bash
npx wrangler pages secret put CLOUD_RUN_ASSEMBLER_URL --project-name shopshot
# Paste your Cloud Run URL when prompted
```

## Test the Service
```bash
# Health check
curl https://YOUR_CLOUD_RUN_URL/health

# Test video assembly
curl -X POST https://YOUR_CLOUD_RUN_URL/assemble \
  -H "Content-Type: application/json" \
  -d '{
    "clips": ["https://videos.pexels.com/video-files/4232959/4232959-hd_1920_1080_24fps.mp4"],
    "videoId": "test_123"
  }'
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/assemble` | POST | Full video assembly |
| `/test` | POST | Test video URL accessibility |

## Cost Estimate
- Cloud Run: ~$0.00002400 per vCPU-second
- Typical 15-30s video: ~30-60 seconds processing = ~$0.001-0.003
- Monthly with 1000 videos: ~$1-3

## Troubleshooting

### "No valid clips to assemble"
- All clips are placeholders or pending
- Wait for Veo 3 clips to complete, then regenerate

### Timeout errors
- Increase Cloud Run timeout to 600 seconds
- Reduce video quality/resolution

### R2 upload fails
- Check R2 API token permissions
- Verify bucket name and account ID
