/* ============================================================
   barcode-scanner.js — Refad ERP v3.0
   ═══════════════════════════════════════════════════════════════
   ✅ كاميرا الموبايل (iOS + Android)
   ✅ USB scanner (keyboard wedge)
   ✅ مسح من صورة (gallery)
   ✅ BarcodeDetector API + ZXing fallback
   ✅ 10 formats (EAN-13, EAN-8, UPC, Code-128, QR, ...)
   ✅ Beep + Vibration
   ✅ كشف Scale Labels (وزن)
   ✅ Debounce ذكي (1500ms)
   ============================================================ */

(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمّل الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 BARCODE FORMATS
  // ═══════════════════════════════════════════════════════════
  const NATIVE_FORMATS = [
    'ean_13', 'ean_8', 'upc_a', 'upc_e',
    'code_128', 'code_39', 'itf', 'qr_code',
    'data_matrix', 'pdf417'
  ];

  const ZXING_FORMATS = [
    'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E',
    'CODE_128', 'CODE_39', 'ITF', 'QR_CODE',
    'DATA_MATRIX', 'PDF_417'
  ];

  // ═══════════════════════════════════════════════════════════
  // 🔊 BEEP
  // ═══════════════════════════════════════════════════════════
  let audioCtx = null;

  function playBeep(freq, duration) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq || 1200;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (duration || 0.1));
      osc.start();
      osc.stop(audioCtx.currentTime + (duration || 0.1));
    } catch (e) {}
  }

  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 80);
  }

  // ═══════════════════════════════════════════════════════════
  // 📊 NORMALIZE / PARSE
  // ═══════════════════════════════════════════════════════════
  function normalizeBarcode(raw) {
    if (!raw) return null;
    const code = String(raw).trim().replace(/[\x00-\x1F\x7F]/g, '');
    if (!code) return null;
    return {
      raw: code,
      variants: code.length === 13 && code.startsWith('0')
        ? [code, code.slice(1)]
        : [code]
    };
  }

  function parseScaleLabel(barcode) {
    if (!barcode || barcode.length !== 13 || barcode.charAt(0) !== '2') return null;
    const format = localStorage.getItem(cfg.SCALE_FORMAT_KEY) || 'weight';
    if (format === 'weight') {
      return {
        plu: barcode.slice(1, 6),
        weight_kg: parseInt(barcode.slice(6, 11), 10) / 1000,
        type: 'weighed'
      };
    }
    return {
      plu: barcode.slice(1, 5),
      total_price: parseInt(barcode.slice(5, 10), 10) / 100,
      type: 'price_embedded'
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 📷 CAMERA SCANNER
  // ═══════════════════════════════════════════════════════════
  class CameraScanner {
    constructor(options) {
      this.opts = options || {};
      this.videoEl = this.opts.videoEl || null;
      this.canvasEl = null;
      this.stream = null;
      this.running = false;
      this.detector = null;
      this.zxingReader = null;
      this.mode = 'unknown';
      this.lastCode = null;
      this.lastTime = 0;
      this.debounceMs = this.opts.debounceMs || cfg.BARCODE_DEBOUNCE_MS || 1500;
      this.onDetect = this.opts.onDetect || function () {};
      this.onError = this.opts.onError || function () {};
      this.rafId = null;
      this.useTorch = false;
    }

    async init() {
      // جرب BarcodeDetector API أولاً
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const usable = NATIVE_FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
          if (usable.length > 0) {
            this.detector = new window.BarcodeDetector({ formats: usable });
            this.mode = 'native';
            console.log('[BarcodeScanner] Native BarcodeDetector ✅', usable.length, 'formats');
            return;
          }
        } catch (e) {
          console.warn('[BarcodeScanner] BarcodeDetector init failed:', e);
        }
      }

      // ZXing fallback
      try {
        await this.loadZXing();
        this.mode = 'zxing';
        console.log('[BarcodeScanner] ZXing fallback ✅');
      } catch (e) {
        this.mode = 'unsupported';
        throw new Error('Barcode scanning غير مدعوم في هذا المتصفح');
      }
    }

    async loadZXing() {
      if (window.ZXing) return;
      await new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    async start() {
      if (this.running) return;
      if (!this.videoEl) throw new Error('videoEl مطلوب');

      if (!this.detector && this.mode !== 'zxing') {
        await this.init();
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        this.videoEl.srcObject = this.stream;
        this.videoEl.setAttribute('playsinline', 'true');
        await this.videoEl.play();

        this.running = true;
        this.scanLoop();
        console.log('[BarcodeScanner] Camera started');
      } catch (e) {
        this.onError(e);
        throw e;
      }
    }

    async scanLoop() {
      if (!this.running) return;

      try {
        var barcode = null;

        if (this.mode === 'native' && this.detector) {
          var results = await this.detector.detect(this.videoEl);
          if (results && results.length > 0) {
            barcode = {
              rawValue: results[0].rawValue,
              format: results[0].format
            };
          }
        } else if (this.mode === 'zxing' && this.zxingReader) {
          // ZXing بيشتغل على canvas
          if (!this.canvasEl) {
            this.canvasEl = document.createElement('canvas');
          }
          var w = this.videoEl.videoWidth;
          var h = this.videoEl.videoHeight;
          if (w > 0 && h > 0) {
            this.canvasEl.width = w;
            this.canvasEl.height = h;
            var ctx = this.canvasEl.getContext('2d');
            ctx.drawImage(this.videoEl, 0, 0, w, h);
            try {
              var result = await this.zxingReader.decodeFromCanvas(this.canvasEl);
              if (result) {
                barcode = {
                  rawValue: result.getText(),
                  format: result.getBarcodeFormat()
                };
              }
            } catch (e) {
              // مفيش باركود في الفريم - عادي
            }
          }
        }

        if (barcode) {
          var now = Date.now();
          var isSameCode = this.lastCode === barcode.rawValue;
          var isWithinDebounce = (now - this.lastTime) < this.debounceMs;

          if (!isSameCode || !isWithinDebounce) {
            this.lastCode = barcode.rawValue;
            this.lastTime = now;
            playBeep(1200, 0.08);
            vibrate(80);
            this.onDetect(barcode);
          }
        }
      } catch (e) {
        // تجاهل أخطاء الفريم الواحد
      }

      if (this.running) {
        this.rafId = requestAnimationFrame(this.scanLoop.bind(this));
      }
    }

    async toggleTorch() {
      if (!this.stream) return false;
      var track = this.stream.getVideoTracks()[0];
      if (!track) return false;
      try {
        var capabilities = track.getCapabilities();
        if (capabilities.torch) {
          this.useTorch = !this.useTorch;
          await track.applyConstraints({
            advanced: [{ torch: this.useTorch }]
          });
          return this.useTorch;
        }
      } catch (e) {}
      return false;
    }

    stop() {
      this.running = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { t.stop(); });
        this.stream = null;
      }
      if (this.videoEl) {
        this.videoEl.srcObject = null;
      }
      console.log('[BarcodeScanner] Camera stopped');
    }

    async scanFromFile(file) {
      if (!file) throw new Error('الملف مطلوب');

      // جرب BarcodeDetector على الصورة أولاً
      if ('BarcodeDetector' in window && this.detector) {
        try {
          var bitmap = await createImageBitmap(file);
          var results = await this.detector.detect(bitmap);
          if (results && results.length > 0) {
            return {
              rawValue: results[0].rawValue,
              format: results[0].format
            };
          }
        } catch (e) {}
      }

      // ZXing fallback
      if (this.mode === 'zxing' && this.zxingReader) {
        var url = URL.createObjectURL(file);
        try {
          var result = await this.zxingReader.decodeFromImageUrl(url);
          URL.revokeObjectURL(url);
          return {
            rawValue: result.getText(),
            format: result.getBarcodeFormat()
          };
        } catch (e) {
          URL.revokeObjectURL(url);
          throw new Error('لم يتم العثور على باركود في الصورة');
        }
      }

      throw new Error('مسح الصور غير مدعوم');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⌨️ USB SCANNER (Keyboard Wedge)
  // ═══════════════════════════════════════════════════════════
  class USBScanner {
    constructor(options) {
      this.opts = options || {};
      this.buffer = '';
      this.lastKeyTime = 0;
      this.maxGapMs = this.opts.maxGapMs || 50; // الفرق بين الأحرف
      this.minLength = this.opts.minLength || 6;
      this.maxLength = this.opts.maxLength || 30;
      this.onDetect = this.opts.onDetect || function () {};
      this.enabled = false;
      this.boundHandler = null;
    }

    start() {
      if (this.enabled) return;
      this.enabled = true;

      var self = this;
      this.boundHandler = function (e) {
        self.handleKey(e);
      };
      document.addEventListener('keydown', this.boundHandler, true);
      console.log('[USBScanner] Started');
    }

    stop() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.boundHandler) {
        document.removeEventListener('keydown', this.boundHandler, true);
        this.boundHandler = null;
      }
      console.log('[USBScanner] Stopped');
    }

    handleKey(e) {
      // تجاهل لو في input/textarea
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      var now = Date.now();
      var gap = now - this.lastKeyTime;
      this.lastKeyTime = now;

      // لو الفرق كبير، ابدأ من جديد
      if (gap > this.maxGapMs) {
        this.buffer = '';
      }

      if (e.key === 'Enter') {
        if (this.buffer.length >= this.minLength) {
          playBeep(1200, 0.08);
          vibrate(80);
          this.onDetect({ rawValue: this.buffer, format: 'usb' });
        }
        this.buffer = '';
        return;
      }

      // حرف واحد
      if (e.key && e.key.length === 1) {
        this.buffer += e.key;
        if (this.buffer.length > this.maxLength) {
          this.buffer = this.buffer.slice(-this.maxLength);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎨 MODAL UI
  // ═══════════════════════════════════════════════════════════
  let modalEl = null;
  let cameraScanner = null;

  function injectModalStyles() {
    if (document.getElementById('refad-barcode-modal-styles')) return;
    var style = document.createElement('style');
    style.id = 'refad-barcode-modal-styles';
    style.textContent = `
      .rb-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(8px);
        display: none; align-items: center; justify-content: center;
        z-index: 100000; padding: 20px;
        font-family: 'Segoe UI', Tahoma, sans-serif;
        direction: rtl;
      }
      .rb-overlay.show { display: flex; }
      .rb-modal {
        background: var(--card, #fff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 20px;
        width: 100%; max-width: 520px;
        max-height: 92vh; overflow-y: auto;
        box-shadow: 0 32px 80px rgba(0,0,0,0.4);
        animation: rb-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes rb-in {
        from { opacity: 0; transform: scale(0.9) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .rb-header {
        padding: 18px 22px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        display: flex; align-items: center; justify-content: space-between;
      }
      .rb-header h3 {
        font-size: 17px; font-weight: 800;
        color: var(--text, #0f172a);
        display: flex; align-items: center; gap: 10px;
        margin: 0;
      }
      .rb-close {
        width: 32px; height: 32px; border-radius: 8px;
        border: none; background: var(--bg-soft, #f8fafc);
        color: var(--text-muted, #64748b);
        cursor: pointer; font-size: 18px;
        display: flex; align-items: center; justify-content: center;
      }
      .rb-close:hover { background: var(--danger-soft, #fee2e2); color: var(--danger, #ef4444); }
      .rb-body { padding: 20px 22px; }
      .rb-video-wrap {
        position: relative;
        width: 100%; aspect-ratio: 4/3;
        background: #000;
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 16px;
      }
      .rb-video-wrap video {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      .rb-scan-frame {
        position: absolute;
        inset: 15%;
        border: 3px solid rgba(20,184,166,0.7);
        border-radius: 12px;
        pointer-events: none;
      }
      .rb-scan-frame::before,
      .rb-scan-frame::after {
        content: '';
        position: absolute;
        width: 40px; height: 40px;
        border: 3px solid #14B8A6;
      }
      .rb-scan-frame::before {
        top: -3px; left: -3px;
        border-right: none; border-bottom: none;
        border-top-left-radius: 12px;
      }
      .rb-scan-frame::after {
        bottom: -3px; right: -3px;
        border-left: none; border-top: none;
        border-bottom-right-radius: 12px;
      }
      .rb-scanline {
        position: absolute;
        left: 5%; right: 5%;
        height: 2px;
        background: linear-gradient(90deg, transparent, #14B8A6, transparent);
        box-shadow: 0 0 12px #14B8A6;
        animation: rb-scan 2s infinite;
        pointer-events: none;
      }
      @keyframes rb-scan {
        0%, 100% { top: 15%; }
        50% { top: 85%; }
      }
      .rb-status {
        padding: 12px 16px;
        background: var(--bg-soft, #f8fafc);
        border-radius: 10px;
        text-align: center;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-muted, #64748b);
        margin-bottom: 16px;
      }
      .rb-status.success {
        background: var(--success-soft, #d1fae5);
        color: var(--success, #10b981);
      }
      .rb-status.error {
        background: var(--danger-soft, #fee2e2);
        color: var(--danger, #ef4444);
      }
      .rb-result {
        padding: 14px;
        background: var(--accent-soft, rgba(20,184,166,0.1));
        border: 1.5px solid var(--accent, #14B8A6);
        border-radius: 10px;
        margin-bottom: 16px;
        word-break: break-all;
      }
      .rb-result-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted, #64748b);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .rb-result-value {
        font-family: 'Courier New', monospace;
        font-size: 18px;
        font-weight: 800;
        color: var(--accent, #14B8A6);
        letter-spacing: 1px;
      }
      .rb-actions {
        display: flex; gap: 8px; flex-wrap: wrap;
      }
      .rb-btn {
        flex: 1; min-width: 100px;
        padding: 10px 16px;
        border-radius: 10px;
        border: none;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.15s;
        font-family: inherit;
      }
      .rb-btn-primary {
        background: var(--accent, #14B8A6);
        color: #fff;
      }
      .rb-btn-primary:hover { background: var(--accent-dark, #0d9488); }
      .rb-btn-ghost {
        background: var(--bg-soft, #f8fafc);
        color: var(--text, #0f172a);
        border: 1px solid var(--border, #e2e8f0);
      }
      .rb-btn-ghost:hover { background: var(--bg, #f1f5f9); }
      .rb-btn-danger {
        background: var(--danger-soft, #fee2e2);
        color: var(--danger, #ef4444);
      }
      .rb-btn-danger:hover { background: var(--danger, #ef4444); color: #fff; }
      .rb-tabs {
        display: flex; gap: 4px;
        background: var(--bg-soft, #f8fafc);
        padding: 4px;
        border-radius: 10px;
        margin-bottom: 16px;
      }
      .rb-tab {
        flex: 1;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--text-muted, #64748b);
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.15s;
        font-family: inherit;
      }
      .rb-tab:hover { color: var(--text, #0f172a); }
      .rb-tab.active {
        background: var(--card, #fff);
        color: var(--accent, #14B8A6);
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }
      .rb-panel { display: none; }
      .rb-panel.active { display: block; }
      .rb-file-input {
        display: none;
      }
      @media (max-width: 640px) {
        .rb-modal { max-width: 100%; border-radius: 16px; }
        .rb-header { padding: 14px 16px; }
        .rb-body { padding: 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function createModal() {
    if (modalEl) return modalEl;
    injectModalStyles();

    modalEl = document.createElement('div');
    modalEl.className = 'rb-overlay';
    modalEl.id = 'rb-overlay';
    modalEl.innerHTML = `
      <div class="rb-modal" role="dialog">
        <div class="rb-header">
          <h3>📷 مسح الباركود</h3>
          <button class="rb-close" id="rb-close-btn">✕</button>
        </div>
        <div class="rb-body">
          <div class="rb-tabs">
            <button class="rb-tab active" data-rb-tab="camera">📷 كاميرا</button>
            <button class="rb-tab" data-rb-tab="file">🖼️ صورة</button>
            <button class="rb-tab" data-rb-tab="manual">⌨️ يدوي</button>
          </div>

          <div class="rb-panel active" data-rb-panel="camera">
            <div class="rb-video-wrap">
              <video id="rb-video" playsinline muted></video>
              <div class="rb-scan-frame"></div>
              <div class="rb-scanline"></div>
            </div>
            <div class="rb-status" id="rb-status">جاري فتح الكاميرا...</div>
            <div class="rb-actions">
              <button class="rb-btn rb-btn-ghost" id="rb-torch-btn" style="display:none;">
                💡 فلاش
              </button>
              <button class="rb-btn rb-btn-danger" id="rb-stop-btn">
                ⏹️ إيقاف
              </button>
            </div>
          </div>

          <div class="rb-panel" data-rb-panel="file">
            <input type="file" id="rb-file-input" class="rb-file-input" accept="image/*">
            <div class="rb-status" id="rb-file-status">اختر صورة تحتوي على باركود</div>
            <div class="rb-actions">
              <button class="rb-btn rb-btn-primary" id="rb-file-btn">
                📁 اختيار صورة
              </button>
            </div>
          </div>

          <div class="rb-panel" data-rb-panel="manual">
            <div class="rb-status" id="rb-manual-status">اكتب الباركود يدوياً</div>
            <input type="text" id="rb-manual-input" style="width:100%;padding:14px;font-size:18px;text-align:center;font-family:monospace;border:2px solid var(--border,#e2e8f0);border-radius:10px;margin-bottom:12px;background:var(--bg-soft,#f8fafc);color:var(--text,#0f172a);direction:ltr;letter-spacing:2px;" placeholder="6221001234567" inputmode="numeric" autocomplete="off">
            <div class="rb-actions">
              <button class="rb-btn rb-btn-primary" id="rb-manual-btn">
                ✅ تأكيد
              </button>
            </div>
          </div>

          <div class="rb-result" id="rb-result" style="display:none;">
            <div class="rb-result-label">الباركود المكتشف</div>
            <div class="rb-result-value" id="rb-result-value"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    bindModalEvents();
    return modalEl;
  }

  function bindModalEvents() {
    // Close
    document.getElementById('rb-close-btn').onclick = function () {
      closeModal();
    };
    modalEl.onclick = function (e) {
      if (e.target === modalEl) closeModal();
    };

    // Tabs
    var tabs = modalEl.querySelectorAll('[data-rb-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].onclick = function () {
        var tab = this.dataset.rbTab;
        var allTabs = modalEl.querySelectorAll('[data-rb-tab]');
        var allPanels = modalEl.querySelectorAll('[data-rb-panel]');
        for (var j = 0; j < allTabs.length; j++) {
          allTabs[j].classList.toggle('active', allTabs[j].dataset.rbTab === tab);
        }
        for (var k = 0; k < allPanels.length; k++) {
          allPanels[k].classList.toggle('active', allPanels[k].dataset.rbPanel === tab);
        }
        if (tab === 'camera') {
          startCamera();
        } else {
          stopCamera();
        }
        if (tab === 'manual') {
          setTimeout(function () {
            document.getElementById('rb-manual-input').focus();
          }, 100);
        }
      };
    }

    // Camera stop
    document.getElementById('rb-stop-btn').onclick = stopCamera;

    // Torch
    document.getElementById('rb-torch-btn').onclick = async function () {
      if (cameraScanner) {
        var on = await cameraScanner.toggleTorch();
        this.style.background = on ? 'var(--accent,#14B8A6)' : '';
        this.style.color = on ? '#fff' : '';
      }
    };

    // File
    document.getElementById('rb-file-btn').onclick = function () {
      document.getElementById('rb-file-input').click();
    };
    document.getElementById('rb-file-input').onchange = async function (e) {
      if (!e.target.files || !e.target.files[0]) return;
      var file = e.target.files[0];
      var fileStatus = document.getElementById('rb-file-status');
      fileStatus.textContent = 'جاري المسح...';
      fileStatus.className = 'rb-status';

      try {
        if (!cameraScanner) {
          cameraScanner = new CameraScanner({});
          await cameraScanner.init();
        }
        var result = await cameraScanner.scanFromFile(file);
        handleDetected(result);
        fileStatus.textContent = '✅ تم المسح بنجاح';
        fileStatus.className = 'rb-status success';
      } catch (err) {
        fileStatus.textContent = '❌ ' + (err.message || 'فشل المسح');
        fileStatus.className = 'rb-status error';
      }
    };

    // Manual
    var manualInput = document.getElementById('rb-manual-input');
    manualInput.onkeydown = function (e) {
      if (e.key === 'Enter') {
        submitManual();
      }
    };
    document.getElementById('rb-manual-btn').onclick = submitManual;

    function submitManual() {
      var val = manualInput.value.trim();
      if (!val) return;
      handleDetected({ rawValue: val, format: 'manual' });
      manualInput.value = '';
    }

    // ESC
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.classList.contains('show')) {
        closeModal();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 🎬 CAMERA CONTROL
  // ═══════════════════════════════════════════════════════════
  async function startCamera() {
    var videoEl = document.getElementById('rb-video');
    var statusEl = document.getElementById('rb-status');
    var torchBtn = document.getElementById('rb-torch-btn');

    if (!cameraScanner) {
      cameraScanner = new CameraScanner({
        videoEl: videoEl,
        onDetect: handleDetected,
        onError: function (err) {
          statusEl.textContent = '❌ ' + (err.message || 'فشل فتح الكاميرا');
          statusEl.className = 'rb-status error';
        }
      });
    } else {
      cameraScanner.videoEl = videoEl;
      cameraScanner.onDetect = handleDetected;
    }

    try {
      statusEl.textContent = 'جاري فتح الكاميرا...';
      statusEl.className = 'rb-status';
      await cameraScanner.start();
      statusEl.textContent = '🎯 وجّه الكاميرا نحو الباركود';
      statusEl.className = 'rb-status';

      // Try to show torch button
      if (cameraScanner.stream) {
        var track = cameraScanner.stream.getVideoTracks()[0];
        if (track) {
          var caps = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.torch) {
            torchBtn.style.display = 'inline-flex';
          }
        }
      }
    } catch (e) {
      statusEl.textContent = '❌ ' + (e.message || 'فشل فتح الكاميرا');
      statusEl.className = 'rb-status error';
    }
  }

  function stopCamera() {
    if (cameraScanner) {
      cameraScanner.stop();
    }
    var statusEl = document.getElementById('rb-status');
    if (statusEl) {
      statusEl.textContent = 'الكاميرا متوقفة';
      statusEl.className = 'rb-status';
    }
    var torchBtn = document.getElementById('rb-torch-btn');
    if (torchBtn) torchBtn.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 HANDLE DETECTED
  // ═══════════════════════════════════════════════════════════
  var currentOnDetect = null;
  var currentOnCancel = null;

  function handleDetected(barcode) {
    if (!barcode || !barcode.rawValue) return;

    var normalized = normalizeBarcode(barcode.rawValue);
    var scale = parseScaleLabel(barcode.rawValue);

    var resultEl = document.getElementById('rb-result');
    var valueEl = document.getElementById('rb-result-value');
    if (resultEl && valueEl) {
      resultEl.style.display = 'block';
      valueEl.textContent = barcode.rawValue;
      if (scale) {
        valueEl.textContent += ' (' + (scale.type === 'weighed'
          ? scale.weight_kg.toFixed(3) + ' كجم'
          : scale.total_price.toFixed(2) + ' ج.م') + ')';
      }
    }

    var payload = {
      raw: barcode.rawValue,
      format: barcode.format,
      normalized: normalized,
      scale: scale
    };

    if (typeof currentOnDetect === 'function') {
      currentOnDetect(payload);
    }

    // Close after short delay
    setTimeout(function () {
      closeModal();
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 PUBLIC API
  // ═══════════════════════════════════════════════════════════
  function openModal(options) {
    options = options || {};
    createModal();
    currentOnDetect = options.onDetect || null;
    currentOnCancel = options.onCancel || null;

    modalEl.classList.add('show');
    document.body.style.overflow = 'hidden';

    // Reset UI
    document.getElementById('rb-result').style.display = 'none';
    var allTabs = modalEl.querySelectorAll('[data-rb-tab]');
    for (var i = 0; i < allTabs.length; i++) {
      allTabs[i].classList.toggle('active', allTabs[i].dataset.rbTab === 'camera');
    }
    var allPanels = modalEl.querySelectorAll('[data-rb-panel]');
    for (var j = 0; j < allPanels.length; j++) {
      allPanels[j].classList.toggle('active', allPanels[j].dataset.rbPanel === 'camera');
    }

    // Start camera by default
    setTimeout(startCamera, 300);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('show');
    document.body.style.overflow = '';
    stopCamera();
    if (typeof currentOnCancel === 'function' && !document.getElementById('rb-result').style.display === 'block') {
      // فاضي
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.Refad = window.Refad || {};
  window.Refad.BarcodeScanner = {
    open: openModal,
    close: closeModal,
    CameraScanner: CameraScanner,
    USBScanner: USBScanner,
    normalize: normalizeBarcode,
    parseScale: parseScaleLabel,
    playBeep: playBeep,
    vibrate: vibrate
  };

  console.log('[Refad] barcode-scanner.js ready ✅');

})();