(() => {
  'use strict';

  // --- HARD BLOCK: Prevent accidental network usage ---
  const deny = () => Promise.reject(new Error('Network calls are disabled. This app runs fully local.'));
  window.fetch = deny;
  window.WebSocket = function () { throw new Error('WebSocket disabled.'); };
  window.EventSource = function () { throw new Error('EventSource disabled.'); };
  if (navigator.sendBeacon) navigator.sendBeacon = () => false;
  const XHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    throw new Error('XMLHttpRequest disabled for privacy.');
  };
  // keep reference to avoid lint/use concerns
  void XHROpen;

  const CATEGORY_ORDER = ['name', 'email', 'phone', 'ssn', 'card', 'custom'];

  const els = {
    dropZone: document.getElementById('dropZone'),
    pickFilesBtn: document.getElementById('pickFilesBtn'),
    fileInput: document.getElementById('fileInput'),
    processAllBtn: document.getElementById('processAllBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    resetBtn: document.getElementById('resetBtn'),
    queueBody: document.getElementById('queueBody'),
    summaryBody: document.getElementById('summaryBody'),
    simpleMode: document.getElementById('simpleMode'),
    advancedRules: document.getElementById('advancedRules'),
    customRegex: document.getElementById('customRegex'),
    globalWarning: document.getElementById('globalWarning'),
    globalError: document.getElementById('globalError')
  };

  /** @type {{id:string,file:File,type:'pdf'|'eml',status:string,message:string,output?:Blob,outputName?:string,summary:Record<string,number>,warning?:string}[]} */
  let queue = [];

  const defaultSummary = () => ({ name: 0, email: 0, phone: 0, ssn: 0, card: 0, custom: 0 });

  function setGlobalWarning(msg = '') {
    els.globalWarning.textContent = msg;
    els.globalWarning.classList.toggle('hidden', !msg);
  }
  function setGlobalError(msg = '') {
    els.globalError.textContent = msg;
    els.globalError.classList.toggle('hidden', !msg);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function luhnLooksValid(num) {
    const digits = num.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = Number(digits[i]);
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function buildRules(customRegexLines = []) {
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;

    const rules = [
      { category: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
      { category: 'phone', regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g },
      { category: 'ssn', regex: /\b\d{3}-?\d{2}-?\d{4}\b/g },
      { category: 'card', regex: /\b(?:\d[ -]*?){13,19}\b/g, filter: luhnLooksValid },
      {
        category: 'name',
        regex: namePattern,
        filter: (value) => {
          const stop = new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','January','February','March','April','May','June','July','August','September','October','November','December','United States']);
          return !stop.has(value);
        }
      }
    ];

    for (const line of customRegexLines) {
      if (!line.trim()) continue;
      try {
        rules.push({ category: 'custom', regex: new RegExp(line, 'g') });
      } catch {
        setGlobalWarning('Some custom regex lines were invalid and skipped.');
      }
    }
    return rules;
  }

  function redactTextWithRules(input, rules) {
    let output = input;
    const counts = defaultSummary();

    for (const rule of rules) {
      const seen = new Set();
      output = output.replace(rule.regex, (match) => {
        if (rule.filter && !rule.filter(match)) return match;
        const key = `${rule.category}:${match}`;
        if (!seen.has(key)) seen.add(key);
        counts[rule.category] += 1;
        return `[REDACTED_${rule.category.toUpperCase()}]`;
      });
    }

    return { text: output, counts };
  }

  function mergeSummary(target, source) {
    for (const k of CATEGORY_ORDER) target[k] = (target[k] || 0) + (source[k] || 0);
  }

  function splitCustomRules() {
    return els.customRegex.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function detectType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.eml')) return 'eml';
    return null;
  }

  function addFiles(fileList) {
    setGlobalError('');
    setGlobalWarning('');

    const accepted = [];
    for (const file of fileList) {
      const t = detectType(file);
      if (!t) continue;
      accepted.push({
        id: crypto.randomUUID(),
        file,
        type: t,
        status: 'Pending',
        message: '',
        summary: defaultSummary()
      });
    }

    if (!accepted.length) {
      setGlobalError('No supported files selected. Please choose .pdf or .eml files.');
      return;
    }

    queue = queue.concat(accepted);
    renderQueue();
    renderSummary();
  }

  function renderQueue() {
    els.queueBody.innerHTML = '';
    for (const item of queue) {
      const tr = document.createElement('tr');

      const downloadCell = item.output
        ? `<button data-download="${item.id}">Download</button>`
        : '-';

      tr.innerHTML = `
        <td>${item.file.name}</td>
        <td>${item.type.toUpperCase()}</td>
        <td><span class="status-pill status-${item.status.toLowerCase()}">${item.status}</span></td>
        <td>${item.message || item.warning || ''}</td>
        <td>${downloadCell}</td>
      `;
      els.queueBody.appendChild(tr);
    }

    els.downloadAllBtn.disabled = !queue.some((q) => q.output);

    els.queueBody.querySelectorAll('button[data-download]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-download');
        const item = queue.find((q) => q.id === id);
        if (item && item.output) downloadBlob(item.output, item.outputName || `redacted-${item.file.name}`);
      });
    });
  }

  function renderSummary() {
    els.summaryBody.innerHTML = '';

    for (const item of queue) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.file.name}</td>
        <td>${item.summary.name}</td>
        <td>${item.summary.email}</td>
        <td>${item.summary.phone}</td>
        <td>${item.summary.ssn}</td>
        <td>${item.summary.card}</td>
        <td>${item.summary.custom}</td>
      `;
      els.summaryBody.appendChild(tr);
    }
  }

  function normalizeLineBreaks(s) {
    return s.replace(/\r?\n/g, '\r\n');
  }

  function redactEml(rawText, rules) {
    const result = { text: '', summary: defaultSummary() };

    const normalized = normalizeLineBreaks(rawText);
    const boundaryIndex = normalized.indexOf('\r\n\r\n');
    const headersRaw = boundaryIndex >= 0 ? normalized.slice(0, boundaryIndex) : normalized;
    const bodyRaw = boundaryIndex >= 0 ? normalized.slice(boundaryIndex + 4) : '';

    const headerLines = headersRaw.split('\r\n');
    const unfolded = [];

    for (const line of headerLines) {
      if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
        unfolded[unfolded.length - 1] += line;
      } else {
        unfolded.push(line);
      }
    }

    const redactedHeaders = unfolded.map((line) => {
      const idx = line.indexOf(':');
      if (idx < 0) return line;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const red = redactTextWithRules(value, rules);
      mergeSummary(result.summary, red.counts);
      return `${key}:${red.text}`;
    });

    const bodyRed = redactTextWithRules(bodyRaw, rules);
    mergeSummary(result.summary, bodyRed.counts);

    result.text = `${redactedHeaders.join('\r\n')}\r\n\r\n${bodyRed.text}`;
    return result;
  }

  function escapePdfString(str) {
    return str.replace(/([\\()])/g, '\\$1');
  }

  async function redactPdf(file, rules) {
    if (!window.pdfjsLib || !window.PDFLib) {
      throw new Error('Missing local vendor libraries: vendor/pdf.min.js and vendor/pdf-lib.min.js');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = null;

    const loadingTask = window.pdfjsLib.getDocument({ data: bytes, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
    const pdfDocJs = await loadingTask.promise;

    const pdfLibDoc = await window.PDFLib.PDFDocument.load(bytes);
    const pdfLibPages = pdfLibDoc.getPages();

    const summary = defaultSummary();
    let pagesWithNoText = 0;

    for (let p = 1; p <= pdfDocJs.numPages; p++) {
      const page = await pdfDocJs.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      if (!textContent.items.length) {
        pagesWithNoText += 1;
        continue;
      }

      const outPage = pdfLibPages[p - 1];
      const pdfHeight = outPage.getHeight();

      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) continue;
        const red = redactTextWithRules(item.str, rules);
        mergeSummary(summary, red.counts);

        if (red.text !== item.str) {
          const m = item.transform;
          const x = m[4];
          const y = m[5];
          const width = Math.max(item.width || (item.str.length * 4), 6);
          const height = Math.max(item.height || Math.abs(m[3]) || 10, 8);

          outPage.drawRectangle({
            x: Math.max(0, x),
            y: Math.max(0, pdfHeight - y - height),
            width: Math.min(width, viewport.width),
            height,
            color: window.PDFLib.rgb(0, 0, 0),
            opacity: 1
          });
        }
      }
    }

    const warning = pagesWithNoText > 0
      ? `Low confidence: ${pagesWithNoText} page(s) had no extractable text (possibly scanned/image-only).`
      : '';

    const outBytes = await pdfLibDoc.save();
    return { blob: new Blob([outBytes], { type: 'application/pdf' }), summary, warning };
  }

  async function processItem(item, rules) {
    item.status = 'Processing';
    item.message = '';
    item.warning = '';
    renderQueue();

    try {
      if (item.type === 'eml') {
        const text = await item.file.text();
        const red = redactEml(text, rules);
        item.summary = red.summary;
        item.output = new Blob([red.text], { type: 'message/rfc822' });
        item.outputName = item.file.name.replace(/\.eml$/i, '.redacted.eml');
      } else if (item.type === 'pdf') {
        const red = await redactPdf(item.file, rules);
        item.summary = red.summary;
        item.output = red.blob;
        item.outputName = item.file.name.replace(/\.pdf$/i, '.redacted.pdf');
        item.warning = red.warning;
      }

      item.status = 'Done';
      item.message = item.warning ? `Done (with warning)` : 'Done';
    } catch (err) {
      item.status = 'Error';
      item.message = err instanceof Error ? err.message : 'Unknown error';
      item.output = undefined;
    }

    renderQueue();
    renderSummary();
  }

  async function processAll() {
    if (!queue.length) {
      setGlobalError('Add at least one PDF/EML file first.');
      return;
    }
    setGlobalError('');
    setGlobalWarning('');

    const rules = buildRules(els.simpleMode.checked ? [] : splitCustomRules());

    for (const item of queue) {
      await processItem(item, rules);
    }

    if (queue.some((q) => q.status === 'Done')) {
      els.downloadAllBtn.disabled = false;
    }
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadAll() {
    const done = queue.filter((q) => q.output);
    if (!done.length) {
      setGlobalError('No processed files available to download.');
      return;
    }
    for (const item of done) {
      downloadBlob(item.output, item.outputName || `redacted-${item.file.name}`);
    }
  }

  function resetAll() {
    queue = [];
    els.fileInput.value = '';
    els.customRegex.value = '';
    setGlobalError('');
    setGlobalWarning('');
    els.downloadAllBtn.disabled = true;
    renderQueue();
    renderSummary();
  }

  function bindUI() {
    els.pickFilesBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => {
      addFiles(Array.from(e.target.files || []));
    });

    els.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropZone.classList.add('drag-over');
    });

    els.dropZone.addEventListener('dragleave', () => {
      els.dropZone.classList.remove('drag-over');
    });

    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('drag-over');
      addFiles(Array.from(e.dataTransfer?.files || []));
    });

    els.dropZone.addEventListener('click', () => els.fileInput.click());

    els.simpleMode.addEventListener('change', () => {
      els.advancedRules.classList.toggle('hidden', els.simpleMode.checked);
    });

    els.processAllBtn.addEventListener('click', processAll);
    els.downloadAllBtn.addEventListener('click', downloadAll);
    els.resetBtn.addEventListener('click', resetAll);
  }

  bindUI();
  renderQueue();
  renderSummary();
})();
