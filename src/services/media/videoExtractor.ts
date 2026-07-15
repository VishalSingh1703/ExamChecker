// ── Video → Pages extractor ───────────────────────────────────────────────────
//
// Records a video slowly flipping through an answer sheet.
// Detects each stable "settled" page using frame difference analysis,
// then extracts one high-quality JPEG per page.
//
// Algorithm (single-pass):
//  1. Sample frames at SAMPLE_INTERVAL_S using HTMLVideoElement seeking
//  2. Compare each frame to the previous using luminance MAD on a tiny canvas
//  3. State machine: STABLE ↔ TURNING
//     - When stable long enough AND past the minimum gap → record timestamp
//  4. Seek back to each recorded timestamp and capture at full resolution

// ── Tunable constants ─────────────────────────────────────────────────────────

const COMPARE_W = 160;          // comparison canvas width (fast, still accurate)
const COMPARE_H = 120;          // comparison canvas height
const SAMPLE_INTERVAL_S = 0.2;  // seek step in seconds
const STABLE_THRESHOLD  = 5.5;  // MAD below this = page is still
const TURNING_THRESHOLD = 16.0; // MAD above this = page is turning
const STABLE_HOLD_S     = 0.45; // seconds of stability before committing a page
const MIN_PAGE_GAP_S    = 0.9;  // minimum seconds between two consecutive page captures
const JPEG_QUALITY      = 0.92; // capture quality (0–1)

// ── Public types ──────────────────────────────────────────────────────────────

export interface VideoExtractionProgress {
  phase: 'scanning' | 'capturing';
  pct: number;           // 0–100
  pagesFound: number;    // pages detected so far (scanning) or captured (capturing)
}

export type VideoProgressCallback = (p: VideoExtractionProgress) => void;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seek video to t and wait for the frame to be ready (RAF for Safari compat). */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise(resolve => {
    const handler = () => {
      video.removeEventListener('seeked', handler);
      // One rAF tick ensures Safari has decoded the frame before drawImage
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener('seeked', handler);
    video.currentTime = t;
  });
}

/** Luminance MAD between current canvas pixels and a reference buffer. */
function computeMAD(
  ctx: CanvasRenderingContext2D,
  prev: Uint8ClampedArray,
): number {
  const curr = ctx.getImageData(0, 0, COMPARE_W, COMPARE_H).data;
  let sum = 0;
  // Stride 16 = every 4th pixel (one RGBA group skipped per sample)
  const samples = curr.length / 16;
  for (let i = 0; i < curr.length; i += 16) {
    const lumCurr  = 0.299 * curr[i]  + 0.587 * curr[i + 1]  + 0.114 * curr[i + 2];
    const lumPrev  = 0.299 * prev[i]  + 0.587 * prev[i + 1]  + 0.114 * prev[i + 2];
    sum += Math.abs(lumCurr - lumPrev);
  }
  return sum / samples;
}

/** canvas.toBlob wrapped as a Promise. */
function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    ),
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractPagesFromVideo(
  file: File,
  onProgress?: VideoProgressCallback,
): Promise<File[]> {
  const objectUrl = URL.createObjectURL(file);

  try {
    // ── Setup video element ──────────────────────────────────────────────────
    const video = document.createElement('video');
    video.muted       = true;
    video.playsInline = true;
    video.preload     = 'auto';
    video.src         = objectUrl;

    // Wait for duration to be known
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load video file.'));
      video.load();
    });

    if (!isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Video duration could not be determined.');
    }

    // Wait until the browser has enough data to seek
    if (video.readyState < 2) {
      await new Promise<void>(resolve => {
        video.oncanplay = () => resolve();
      });
    }

    const duration = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // ── Canvases ─────────────────────────────────────────────────────────────
    // Small canvas for fast motion comparison
    const cmpCanvas = document.createElement('canvas');
    cmpCanvas.width  = COMPARE_W;
    cmpCanvas.height = COMPARE_H;
    const cmpCtx = cmpCanvas.getContext('2d', { willReadFrequently: true })!;

    // Full-res canvas for final captures (allocated once, reused)
    const capCanvas = document.createElement('canvas');
    capCanvas.width  = vw;
    capCanvas.height = vh;
    const capCtx = capCanvas.getContext('2d')!;

    // ── Pass 1: scan for stable page timestamps ───────────────────────────────
    const captureTimestamps: number[] = [];
    let prevPixels:       Uint8ClampedArray | null = null;
    let stableFromTime:   number | null            = null; // when current stable run started
    let lastCaptureTime   = -MIN_PAGE_GAP_S;

    const totalSamples = Math.ceil(duration / SAMPLE_INTERVAL_S) + 1;

    for (let step = 0; step <= totalSamples; step++) {
      const t = Math.min(step * SAMPLE_INTERVAL_S, duration);
      await seekTo(video, t);

      cmpCtx.drawImage(video, 0, 0, COMPARE_W, COMPARE_H);

      onProgress?.({
        phase: 'scanning',
        pct: Math.round((step / totalSamples) * 80),
        pagesFound: captureTimestamps.length,
      });

      if (!prevPixels) {
        // Very first sample — mark as stable start
        prevPixels    = cmpCtx.getImageData(0, 0, COMPARE_W, COMPARE_H).data.slice() as Uint8ClampedArray;
        stableFromTime = t;
        continue;
      }

      const mad = computeMAD(cmpCtx, prevPixels);
      prevPixels = cmpCtx.getImageData(0, 0, COMPARE_W, COMPARE_H).data.slice() as Uint8ClampedArray;

      if (mad > TURNING_THRESHOLD) {
        // Page is turning — break any stable run
        stableFromTime = null;
      } else if (mad < STABLE_THRESHOLD) {
        // Frame is stable
        if (stableFromTime === null) {
          stableFromTime = t; // just became stable
        } else {
          const stableDuration = t - stableFromTime;
          const gapSinceLast   = t - lastCaptureTime;

          if (stableDuration >= STABLE_HOLD_S && gapSinceLast >= MIN_PAGE_GAP_S) {
            // Page has been stable long enough — record best frame in this run
            // Use the midpoint of the stable run (avoids leading-edge blur)
            const captureAt = stableFromTime + stableDuration / 2;
            captureTimestamps.push(captureAt);
            lastCaptureTime = t;
            // Advance stableFromTime past the hold window to prevent re-triggering
            stableFromTime = t + STABLE_HOLD_S;
          }
        }
      }
      // AMBIGUOUS (between thresholds): do nothing — preserve current state
    }

    // Post-loop: capture the last stable segment if not yet captured
    if (
      stableFromTime !== null &&
      (duration - stableFromTime) >= STABLE_HOLD_S &&
      (duration - lastCaptureTime) >= MIN_PAGE_GAP_S
    ) {
      captureTimestamps.push(stableFromTime + (duration - stableFromTime) / 2);
    }

    if (captureTimestamps.length === 0) {
      // Fallback: if nothing detected, capture at regular intervals
      for (let t = 0.5; t < duration; t += Math.max(1, duration / 10)) {
        captureTimestamps.push(t);
      }
    }

    // ── Pass 2: capture pages at full resolution ──────────────────────────────
    const pageFiles: File[] = [];

    for (let i = 0; i < captureTimestamps.length; i++) {
      await seekTo(video, captureTimestamps[i]);
      capCtx.drawImage(video, 0, 0, vw, vh);

      onProgress?.({
        phase: 'capturing',
        pct: Math.round(80 + ((i + 1) / captureTimestamps.length) * 20),
        pagesFound: captureTimestamps.length,
      });

      const blob = await toBlob(capCanvas, JPEG_QUALITY);
      pageFiles.push(new File([blob], `page-${i + 1}.jpg`, { type: 'image/jpeg' }));
    }

    onProgress?.({ phase: 'capturing', pct: 100, pagesFound: pageFiles.length });
    return pageFiles;

  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
