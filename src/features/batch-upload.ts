// ============================================================================
// BATCH UPLOAD QUEUE - Client-side multi-product upload and processing
// ============================================================================

export function getBatchUploadCSS(): string {
  return `
    /* Batch Mode Toggle */
    .batch-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: rgba(255,255,255,0.7);
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      margin-bottom: 16px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .batch-toggle:hover { border-color: #3B82F6; }
    .batch-toggle.active {
      background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
      border-color: #3B82F6;
    }
    .batch-toggle-switch {
      width: 40px;
      height: 22px;
      background: #D1D5DB;
      border-radius: 11px;
      position: relative;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    .batch-toggle.active .batch-toggle-switch {
      background: #3B82F6;
    }
    .batch-toggle-switch::after {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      background: white;
      border-radius: 50%;
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .batch-toggle.active .batch-toggle-switch::after {
      transform: translateX(18px);
    }
    .batch-toggle-text {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
    }
    .batch-toggle-sub {
      font-size: 11px;
      color: #6B7280;
    }
    .batch-toggle .batch-badge {
      margin-left: auto;
      padding: 3px 8px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
    }

    /* Batch Queue */
    .batch-queue {
      display: none;
      margin-top: 16px;
    }
    .batch-queue.show { display: block; }
    .batch-queue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .batch-queue-title {
      font-size: 14px;
      font-weight: 600;
      color: #1F2937;
    }
    .batch-queue-count {
      font-size: 12px;
      color: #6B7280;
      padding: 4px 10px;
      background: #F3F4F6;
      border-radius: 20px;
    }
    .batch-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      margin-bottom: 8px;
      transition: all 0.2s;
    }
    .batch-item.processing {
      border-color: #3B82F6;
      background: #EFF6FF;
    }
    .batch-item.completed {
      border-color: #10B981;
      background: #ECFDF5;
    }
    .batch-item.failed {
      border-color: #EF4444;
      background: #FEF2F2;
    }
    .batch-item-thumb {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .batch-item-info {
      flex: 1;
      min-width: 0;
    }
    .batch-item-name {
      font-size: 13px;
      font-weight: 500;
      color: #1F2937;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .batch-item-status {
      font-size: 11px;
      color: #6B7280;
    }
    .batch-item-status.processing { color: #3B82F6; }
    .batch-item-status.completed { color: #059669; }
    .batch-item-status.failed { color: #EF4444; }
    .batch-item-remove {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: #9CA3AF;
      cursor: pointer;
      font-size: 14px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .batch-item-remove:hover { color: #EF4444; background: #FEF2F2; }
    .batch-progress-bar {
      width: 100%;
      height: 4px;
      background: #E5E7EB;
      border-radius: 2px;
      margin-top: 4px;
      overflow: hidden;
    }
    .batch-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3B82F6, #8B5CF6);
      border-radius: 2px;
      transition: width 0.3s;
    }

    /* Batch Actions */
    .batch-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }
    .batch-start-btn {
      flex: 1;
      padding: 14px 24px;
      background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(139, 92, 246, 0.35);
      transition: all 0.2s;
    }
    .batch-start-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(139, 92, 246, 0.45); }
    .batch-start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .batch-clear-btn {
      padding: 14px 20px;
      background: white;
      color: #6B7280;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      font-size: 14px;
      cursor: pointer;
    }
    .batch-clear-btn:hover { background: #F9FAFB; }

    /* Batch Credits Warning */
    .batch-credits-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #FEF3C7;
      border: 1px solid #FCD34D;
      border-radius: 8px;
      margin-top: 12px;
      font-size: 12px;
      color: #92400E;
    }
    .batch-credits-ok {
      background: #ECFDF5;
      border-color: #6EE7B7;
      color: #065F46;
    }

    /* Batch Summary */
    .batch-summary {
      padding: 24px;
      background: white;
      border-radius: 16px;
      border: 1px solid #E5E7EB;
      text-align: center;
    }
    .batch-summary-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }
    .batch-summary-title {
      font-size: 20px;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 8px;
    }
    .batch-summary-stats {
      display: flex;
      justify-content: center;
      gap: 24px;
      margin: 16px 0;
    }
    .batch-summary-stat {
      text-align: center;
    }
    .batch-summary-stat-value {
      font-size: 24px;
      font-weight: 800;
      color: #1F2937;
    }
    .batch-summary-stat-label {
      font-size: 12px;
      color: #6B7280;
    }
  `;
}

export function getBatchUploadScript(): string {
  return `
    // Batch Upload State
    let batchMode = false;
    let batchQueue = [];
    let batchProcessing = false;
    const MAX_BATCH = 20;

    function toggleBatchMode() {
      batchMode = !batchMode;
      const toggle = document.getElementById('batch-toggle');
      const queue = document.getElementById('batch-queue');
      const singleUpload = document.getElementById('single-upload-zone');
      const batchUpload = document.getElementById('batch-upload-zone');
      
      if (toggle) toggle.classList.toggle('active', batchMode);
      if (queue) queue.classList.toggle('show', batchMode);
      if (singleUpload) singleUpload.style.display = batchMode ? 'none' : 'flex';
      if (batchUpload) batchUpload.style.display = batchMode ? 'flex' : 'none';
      
      if (!batchMode) {
        batchQueue = [];
        renderBatchQueue();
      }
    }

    function handleBatchFiles(files) {
      const fileList = Array.from(files);
      const remaining = MAX_BATCH - batchQueue.length;
      
      if (remaining <= 0) {
        alert('Maximum ' + MAX_BATCH + ' products per batch. Remove some to add more.');
        return;
      }

      const toAdd = fileList.slice(0, remaining);
      
      toAdd.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > 20 * 1024 * 1024) {
          alert(file.name + ' is too large (max 20MB)');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
          batchQueue.push({
            id: Date.now() + '_' + Math.random().toString(36).substring(7),
            file: file,
            name: file.name.replace(/\\.[^.]+$/, ''),
            dataUrl: e.target.result,
            status: 'queued', // queued | processing | completed | failed
            sessionId: null,
            progress: 0,
            error: null
          });
          renderBatchQueue();
        };
        reader.readAsDataURL(file);
      });
    }

    function removeBatchItem(itemId) {
      batchQueue = batchQueue.filter(item => item.id !== itemId);
      renderBatchQueue();
    }

    function renderBatchQueue() {
      const container = document.getElementById('batch-queue-items');
      const countEl = document.getElementById('batch-count');
      const startBtn = document.getElementById('batch-start-btn');
      const creditsInfo = document.getElementById('batch-credits-info');
      
      if (countEl) countEl.textContent = batchQueue.length + '/' + MAX_BATCH;
      if (startBtn) startBtn.disabled = batchQueue.length === 0 || batchProcessing;
      
      // Calculate credits needed
      const creditsNeeded = batchQueue.filter(i => i.status === 'queued').length * 10;
      if (creditsInfo) {
        const currentCredits = parseInt(document.getElementById('credit-standard-count')?.textContent || '0');
        const hasEnough = currentCredits >= creditsNeeded;
        creditsInfo.className = 'batch-credits-info' + (hasEnough ? ' batch-credits-ok' : '');
        creditsInfo.innerHTML = (hasEnough ? '✓' : '⚠️') + ' This batch needs ' + creditsNeeded + ' credits. You have ' + currentCredits + '.';
        creditsInfo.style.display = batchQueue.length > 0 ? 'flex' : 'none';
      }
      
      if (!container) return;
      
      if (batchQueue.length === 0) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:#9CA3AF;font-size:13px;">Drop images here or click to add (up to ' + MAX_BATCH + ')</div>';
        return;
      }

      container.innerHTML = batchQueue.map(item => {
        const statusClass = item.status === 'processing' ? 'processing' : item.status === 'completed' ? 'completed' : item.status === 'failed' ? 'failed' : '';
        const statusText = item.status === 'queued' ? 'Waiting...' : item.status === 'processing' ? 'Generating...' : item.status === 'completed' ? '✓ Complete' : '✗ ' + (item.error || 'Failed');
        
        return '<div class="batch-item ' + statusClass + '">' +
          '<img src="' + item.dataUrl + '" class="batch-item-thumb">' +
          '<div class="batch-item-info">' +
            '<div class="batch-item-name">' + item.name + '</div>' +
            '<div class="batch-item-status ' + item.status + '">' + statusText + '</div>' +
            (item.status === 'processing' ? '<div class="batch-progress-bar"><div class="batch-progress-fill" style="width:' + item.progress + '%"></div></div>' : '') +
          '</div>' +
          (item.status === 'queued' ? '<button class="batch-item-remove" onclick="removeBatchItem(\\'' + item.id + '\\')">×</button>' : '') +
          (item.status === 'completed' ? '<a href="/results/' + item.sessionId + '" style="font-size:12px;color:#3B82F6;text-decoration:none;font-weight:500;">View →</a>' : '') +
        '</div>';
      }).join('');
    }

    async function startBatch() {
      if (batchProcessing || batchQueue.length === 0) return;
      batchProcessing = true;
      
      const startBtn = document.getElementById('batch-start-btn');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="spinner-sm"></span> Processing batch...';
      }

      for (let i = 0; i < batchQueue.length; i++) {
        const item = batchQueue[i];
        if (item.status !== 'queued') continue;

        item.status = 'processing';
        renderBatchQueue();

        try {
          // Create session
          const sessionRes = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: item.name, original_image: item.dataUrl })
          });
          const sessionData = await sessionRes.json();
          
          if (!sessionData.success) throw new Error(sessionData.error || 'Failed to create session');
          item.sessionId = sessionData.id;

          // Generate all variations
          const genPromises = [];
          for (let v = 0; v < 10; v++) {
            genPromises.push(
              fetch('/api/generate-single/' + item.sessionId + '/' + v, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  originalImage: item.dataUrl,
                  productName: item.name,
                  model: selectedModel || 'flash',
                  productSize: selectedSize || 'medium'
                })
              }).then(res => res.json()).then(data => {
                item.progress = Math.min(95, item.progress + 10);
                renderBatchQueue();
                return data;
              })
            );
          }

          await Promise.allSettled(genPromises);

          // Complete session
          await fetch('/api/sessions/' + item.sessionId + '/complete', { method: 'POST' });
          
          item.status = 'completed';
          item.progress = 100;
        } catch (err) {
          item.status = 'failed';
          item.error = err.message || 'Generation failed';
          console.error('Batch item failed:', item.name, err);
        }

        renderBatchQueue();
      }

      batchProcessing = false;
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '🚀 Start Batch Generation';
      }

      // Show summary
      const completed = batchQueue.filter(i => i.status === 'completed').length;
      const failed = batchQueue.filter(i => i.status === 'failed').length;
      
      if (completed > 0) {
        alert('Batch complete! ' + completed + ' products generated' + (failed > 0 ? ', ' + failed + ' failed.' : '.'));
      }
      
      // Refresh sessions list and credits
      if (typeof loadSessions === 'function') loadSessions();
      if (typeof updateCreditsDisplay === 'function') updateCreditsDisplay();
    }
  `;
}
