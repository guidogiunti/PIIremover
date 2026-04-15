# Local PII Remover (PDF + EML)

A beginner-friendly offline web app that redacts personally identifiable information (PII) in `.pdf` and `.eml` files directly in your browser.

> **Privacy notice:** All processing happens locally. No data leaves your device.

---

## 3-step usage

1. **Open `index.html` in a modern browser** (Chrome/Edge/Firefox).
2. **Drag/drop or pick `.pdf` and `.eml` files**, then click **Process All**.
3. Review queue + summary, then click **Download All** (or per-file Download).

---

## Offline & privacy guarantees

- No backend and no cloud APIs.
- Runtime network calls are explicitly blocked (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, beacon).
- No telemetry or analytics.
- No raw sensitive values are logged.
- Includes **Clear memory / reset** button to wipe in-memory queue/results.

---

## Local vendored dependencies

This app expects local files in `vendor/` (no CDN):

- `vendor/pdf.min.js` (PDF.js build)
- `vendor/pdf-lib.min.js` (pdf-lib build)
- `vendor/compromise.min.js` (optional, improves person-name detection)

If PDF libraries are missing, PDF processing will show a helpful error and EML processing still works.
If `compromise.min.js` is missing, the app falls back to regex-only name detection.

---

## Features

- Multi-file queue with statuses: Pending / Processing / Done / Error.
- Supports `.pdf` and `.eml` in one batch.
- Shared PII engine used by both file paths.
- Built-in categories:
  - Full names (best-effort heuristic with broader international token handling)
  - Email addresses
  - Phone numbers (US + international formats)
  - SSNs
  - Credit-card-like numbers (Luhn check)
- Optional advanced custom regex rules (one per line).
- Output naming:
  - `*.redacted.pdf`
  - `*.redacted.eml`
- Redaction summary counts per category and file.

---

## Known limitations

- **Scanned/image-only PDFs:** text extraction can be low-confidence; app warns when pages have no extractable text.
- PDF redaction is visual overlay (black boxes) based on extractable text coordinates.
- Name detection is heuristic and may over/under-match.
- Name detection uses heuristics + connector-word dictionary and may still over/under-match.
- Complex MIME/encoded EML bodies are handled best-effort for text redaction.

---

## Troubleshooting

- **“Missing local vendor libraries”**
  - Add `pdf.min.js` and `pdf-lib.min.js` into `/vendor`.
- **PDF processed but some PII remains**
  - File may be scanned/image-based; run OCR first, then re-process.
- **Custom regex seems ignored**
  - Disable Simple Mode.
  - Validate each regex line syntax.
- **No files can be selected**
  - Confirm extensions are `.pdf` or `.eml`.

---

## QA checklist

- [ ] Works with internet disconnected.
- [ ] Browser Network tab shows zero external requests during processing.
- [ ] Output files are generated with `.redacted.pdf` and `.redacted.eml` suffixes.
- [ ] Redacted outputs contain placeholders/black overlays where PII is detected.
- [ ] Summary table shows per-file redaction counts.

---

## Security notes

- Keep this tool local; do not host publicly.
- Review redacted outputs manually before sharing.
- For high-assurance workflows, pair with manual QA and legal/privacy review.
