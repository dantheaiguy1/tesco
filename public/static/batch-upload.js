// ============================================================================
// BATCH / MULTI-PRODUCT UPLOAD QUEUE
// ============================================================================
// Queue up to 20 product images, process sequentially, bulk download results
// Each product gets its own session with 10 variation images

const BATCH_MAX = 20;
let batchQueue = [];
let batchProcessing = false;
let batchResults = [];

/**
 * Get the batch upload panel HTML for the app page
 */
function getBatchUploadHTML() {
  return `
    <div id="batch-panel" class="hidden mt-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
              <i class="fas fa-layer-group text-white"></i>
            </div>
            <div>
              <h3 class="font-semibold text-brand-dark">Batch Processing</h3>
              <p class="text-xs text-brand-gray">Queue up to ${BATCH_MAX} products</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span id="batch-count" class="text-sm font-mono text-brand-gray">0/${BATCH_MAX}</span>
            <button onclick="closeBatchPanel()" class="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-brand-gray transition">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
        </div>

        <!-- Queue -->
        <div id="batch-queue" class="p-4 space-y-2 max-h-80 overflow-y-auto"></div>
        
        <!-- Add More -->
        <div class="px-4 pb-2">
          <label id="batch-add-area" class="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition">
            <i class="fas fa-plus text-brand-gray"></i>
            <span class="text-sm text-brand-gray">Add more products</span>
            <input type="file" accept="image/*" multiple class="hidden" onchange="addToBatch(event)">
          </label>
        </div>

        <!-- Controls -->
        <div class="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div class="text-sm text-brand-gray">
            <span id="batch-credits-needed">0</span> credits needed
          </div>
          <div class="flex items-center gap-2">
            <button onclick="clearBatch()" class="px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition">
              Clear All
            </button>
            <button onclick="startBatchProcessing()" id="batch-start-btn" 
                    class="px-6 py-2.5 gradient-bg text-white rounded-xl font-semibold text-sm shadow-lg hover:shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled>
              <i class="fas fa-play mr-2"></i>Process All
            </button>
          </div>
        </div>

        <!-- Progress (shown during processing) -->
        <div id="batch-progress" class="hidden px-6 py-4 border-t border-slate-100 bg-slate-50">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-brand-dark">Processing...</span>
            <span id="batch-progress-text" class="text-sm text-brand-gray">0 of 0</span>
          </div>
          <div class="w-full bg-slate-200 rounded-full h-2">
            <div id="batch-progress-bar" class="h-2 rounded-full gradient-bg transition-all duration-500" style="width:0%"></div>
          </div>
          <div id="batch-current-item" class="text-xs text-brand-gray mt-2"></div>
        </div>

        <!-- Results (shown after processing) -->
        <div id="batch-results" class="hidden px-6 py-4 border-t border-slate-100">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-semibold text-brand-dark">
              <i class="fas fa-check-circle text-green-500 mr-1"></i>
              Batch Complete!
            </span>
            <button onclick="downloadBatchResults()" class="gradient-bg px-4 py-2 rounded-lg text-white text-sm font-semibold">
              <i class="fas fa-download mr-1"></i>Download All (ZIP)
            </button>
          </div>
          <div id="batch-results-list" class="space-y-1 max-h-40 overflow-y-auto"></div>
        </div>
      </div>
    </div>`;
}

/**
 * Toggle batch mode on the upload page
 */
function toggleBatchMode() {
  const panel = document.getElementById('batch-panel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    // Trigger file picker immediately on first open
    if (batchQueue.length === 0) {
      document.querySelector('#batch-add-area input').click();
    }
  } else {
    closeBatchPanel();
  }
}

function closeBatchPanel() {
  document.getElementById('batch-panel').classList.add('hidden');
}

/**
 * Add files to the batch queue
 */
function addToBatch(event) {
  const files = Array.from(event.target.files);
  event.target.value = ''; // Reset so same files can be re-selected

  const remaining = BATCH_MAX - batchQueue.length;
  if (remaining <= 0) {
    alert(`Maximum ${BATCH_MAX} products per batch. Remove some to add more.`);
    return;
  }

  const toAdd = files.slice(0, remaining);
  if (toAdd.length < files.length) {
    alert(`Only adding ${toAdd.length} of ${files.length} selected. Maximum ${BATCH_MAX} per batch.`);
  }

  toAdd.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      batchQueue.push({
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        file: file,
        name: file.name.replace(/\.[^.]+$/, ''),
        preview: e.target.result,
        status: 'queued', // queued | processing | complete | failed
        sessionId: null,
        resultCount: 0
      });
      renderBatchQueue();
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Render the batch queue UI
 */
function renderBatchQueue() {
  const container = document.getElementById('batch-queue');
  const countEl = document.getElementById('batch-count');
  const creditsEl = document.getElementById('batch-credits-needed');
  const startBtn = document.getElementById('batch-start-btn');

  countEl.textContent = `${batchQueue.length}/${BATCH_MAX}`;
  // Each product uses 10 credits (Standard model)
  creditsEl.textContent = batchQueue.length * 10;
  startBtn.disabled = batchQueue.length === 0 || batchProcessing;

  container.innerHTML = batchQueue.map((item, idx) => {
    const statusIcon = item.status === 'complete' ? '<i class="fas fa-check-circle text-green-500"></i>' :
                       item.status === 'failed' ? '<i class="fas fa-exclamation-circle text-red-500"></i>' :
                       item.status === 'processing' ? '<div class="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>' :
                       '<i class="fas fa-clock text-slate-300"></i>';

    const removeBtn = item.status === 'queued' ? 
      `<button onclick="removeBatchItem('${item.id}')" class="w-6 h-6 rounded-full hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-400 transition">
        <i class="fas fa-xmark text-xs"></i>
      </button>` : '';

    const viewBtn = item.status === 'complete' && item.sessionId ?
      `<a href="/results/${item.sessionId}" target="_blank" class="text-xs text-blue-500 hover:text-blue-600">View</a>` : '';

    return `
      <div class="flex items-center gap-3 p-2 rounded-lg ${item.status === 'processing' ? 'bg-purple-50 border border-purple-100' : 'bg-slate-50'}" id="batch-item-${item.id}">
        <img src="${item.preview}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" alt="${item.name}">
        <div class="flex-1 min-w-0">
          <input type="text" value="${item.name}" onchange="updateBatchItemName('${item.id}', this.value)" 
                 class="text-sm font-medium text-brand-dark bg-transparent border-none outline-none w-full truncate ${batchProcessing ? 'pointer-events-none' : ''}"
                 ${batchProcessing ? 'readonly' : ''}>
          <p class="text-[11px] text-brand-gray">${item.status === 'complete' ? `${item.resultCount} images generated` : item.status}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${viewBtn}
          ${statusIcon}
          ${removeBtn}
        </div>
      </div>`;
  }).join('');
}

function removeBatchItem(id) {
  batchQueue = batchQueue.filter(item => item.id !== id);
  renderBatchQueue();
}

function updateBatchItemName(id, newName) {
  const item = batchQueue.find(i => i.id === id);
  if (item) item.name = newName;
}

function clearBatch() {
  if (batchProcessing) return;
  batchQueue = [];
  batchResults = [];
  renderBatchQueue();
  document.getElementById('batch-results').classList.add('hidden');
}

/**
 * Start processing the batch queue
 */
async function startBatchProcessing() {
  if (batchQueue.length === 0 || batchProcessing) return;

  // Check auth
  try {
    const authRes = await fetch('/api/auth/me', { credentials: 'include' });
    const authData = await authRes.json();
    if (!authData.user) {
      window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    
    // Check credits
    const totalNeeded = batchQueue.length * 10;
    const available = (authData.user.cheaper_credits || 0);
    if (available < totalNeeded) {
      alert(`Not enough credits. Need ${totalNeeded} Standard credits, have ${available}. Top up or reduce batch size.`);
      return;
    }
  } catch (e) {
    alert('Please log in to use batch processing.');
    return;
  }

  batchProcessing = true;
  batchResults = [];
  document.getElementById('batch-start-btn').disabled = true;
  document.getElementById('batch-progress').classList.remove('hidden');
  document.getElementById('batch-results').classList.add('hidden');
  document.getElementById('batch-add-area').style.display = 'none';

  const total = batchQueue.length;
  let completed = 0;

  for (let i = 0; i < batchQueue.length; i++) {
    const item = batchQueue[i];
    item.status = 'processing';
    renderBatchQueue();

    document.getElementById('batch-progress-text').textContent = `${completed} of ${total}`;
    document.getElementById('batch-progress-bar').style.width = `${(completed / total) * 100}%`;
    document.getElementById('batch-current-item').textContent = `Processing: ${item.name}...`;

    try {
      // 1. Create session
      const sessionRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: item.name,
          original_image: item.preview,
          product_size: 'medium',
          model: 'flash' // Use Standard for batch (faster)
        })
      });
      const sessionData = await sessionRes.json();
      
      if (!sessionData.success || !sessionData.sessionId) {
        throw new Error(sessionData.error || 'Failed to create session');
      }

      item.sessionId = sessionData.sessionId;

      // 2. Generate all 10 variations
      const genPromises = [];
      for (let v = 0; v < 10; v++) {
        genPromises.push(
          fetch(`/api/generate-single/${item.sessionId}/${v}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              originalImage: item.preview,
              productName: item.name,
              model: 'flash'
            })
          }).then(r => r.json()).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.allSettled(genPromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

      // 3. Complete session
      await fetch(`/api/sessions/${item.sessionId}/complete`, { method: 'POST' });

      item.status = 'complete';
      item.resultCount = successCount;
      batchResults.push({
        name: item.name,
        sessionId: item.sessionId,
        imageCount: successCount
      });

    } catch (err) {
      console.error(`Batch item ${item.name} failed:`, err);
      item.status = 'failed';
    }

    completed++;
    renderBatchQueue();
    document.getElementById('batch-progress-text').textContent = `${completed} of ${total}`;
    document.getElementById('batch-progress-bar').style.width = `${(completed / total) * 100}%`;
  }

  // Complete
  batchProcessing = false;
  document.getElementById('batch-current-item').textContent = 'All done!';
  document.getElementById('batch-add-area').style.display = '';
  
  // Show results
  showBatchResults();

  // Track event
  try {
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'batch_complete', data: { count: total, successes: batchResults.length } })
    });
  } catch (e) { /* non-critical */ }
}

function showBatchResults() {
  const resultsDiv = document.getElementById('batch-results');
  const listDiv = document.getElementById('batch-results-list');
  resultsDiv.classList.remove('hidden');

  listDiv.innerHTML = batchResults.map(r => `
    <div class="flex items-center justify-between py-1">
      <span class="text-sm text-brand-dark">${r.name} - ${r.imageCount} images</span>
      <a href="/results/${r.sessionId}" target="_blank" class="text-xs text-blue-500 hover:underline">View &rarr;</a>
    </div>
  `).join('');
}

/**
 * Download all batch results as a single ZIP
 */
async function downloadBatchResults() {
  if (batchResults.length === 0) return;

  const statusEl = document.getElementById('batch-current-item');
  statusEl.textContent = 'Fetching images for download...';

  try {
    const zip = new JSZip();

    for (const result of batchResults) {
      statusEl.textContent = `Fetching: ${result.name}...`;
      
      const res = await fetch(`/api/sessions/${result.sessionId}`);
      const data = await res.json();
      
      if (data.success && data.images) {
        const folder = zip.folder(result.name.replace(/[^a-zA-Z0-9-_ ]/g, ''));
        
        // Add original
        if (data.session?.original_image) {
          const origBase64 = data.session.original_image.split(',')[1];
          if (origBase64) folder.file('00-original.jpg', origBase64, { base64: true });
        }
        
        // Add generated
        data.images.forEach((img, idx) => {
          const base64 = img.image_data.split(',')[1];
          if (base64) {
            folder.file(`${(idx + 1).toString().padStart(2, '0')}-${img.variation_type}.jpg`, base64, { base64: true });
          }
        });
      }
    }

    statusEl.textContent = 'Creating ZIP...';
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      statusEl.textContent = `Creating ZIP... ${Math.round(meta.percent)}%`;
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shopshot-batch-${new Date().toISOString().split('T')[0]}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    statusEl.textContent = 'Download complete!';
  } catch (err) {
    console.error('Batch download error:', err);
    statusEl.textContent = 'Download failed. Try downloading individual sessions.';
  }
}
