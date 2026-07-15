// ── Video → Pages extractor ───────────────────────────────────────────────────
//
// Records a video slowly flipping through an answer sheet.
// Detects each stable "settled" page using frame difference analysis,
// then extracts one high-quality JPEG per page.
//
// Algorithm:
//  1. Sample frames at SAMPLE_INTERVAL_S using HTMLVideoElement seeking
//  2. Compare each frame to the previous using luminance MAD on a tiny canvas
//  3. State machine: STABLE ↔ TURNING — one capture per stable run.
//     A run only ends when a page turn is CONFIRMED (sustained motion across
//     TURN_CONFIRM_SAMPLES consecutive samples), so hand jitter can't split
//     one page into two, and a page held still for long yields exactly one capture.
//  4. Seek back to each recorded timestamp and capture at full resolution,
//     dropping any capture whose content matches the previously kept page
//     (near-identical luminance = the same page seen twice).

// ── Tunable constants ─────────────────────────────────────────────────────────

const COMPARE_W = 160;            // comparison canvas width (fast, still accurate)
const COMPARE_H = 120;            // comparison canvas height
const SAMPLE_INTERVAL_S = 0.2;    // seek step in seconds
const STABLE_THRESHOLD  = 5.5;    // MAD below this = page is still
const TURNING_THRESHOLD = 16.0;   // MAD above this = page is turning
const TURN_CONFIRM_SAMPLES = 2;   // consecutive turning samples needed to confirm a page turn
const STABLE_HOLD_S     = 0.45;   // seconds of stability before committing a page
const MIN_PAGE_GAP_S    = 0.9;    // minimum seconds between two consecutive page captures
const DUPLICATE_MAD     = 3.0;    // captures closer than this (luminance MAD) are the same page
const JPEG_QUALITY      = 0.92;   // capture quality (0–1)

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
    // One capture per stable run. A run ends only when a page turn is confirmed
    // (TURN_CONFIRM_SAMPLES consecutive high-motion samples), so a page held
    // still for many seconds produces exactly one capture, and a single jittery
    // frame cannot split one page into two.
    const captureTimestamps: number[] = [];
    let prevPixels:      Uint8ClampedArray | null = null;
    let stableFromTime:  number | null            = null; // when current stable run started
    let capturedThisRun  = false;                          // already captured the current run?
    let turningStreak    = 0;                              // consecutive samples above TURNING_THRESHOLD
    let lastCaptureTime  = -MIN_PAGE_GAP_S;

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
        turningStreak++;
        if (turningStreak >= TURN_CONFIRM_SAMPLES) {
          // Confirmed page turn — end the current run; next stable frame starts a new page
          stableFromTime  = null;
          capturedThisRun = false;
        }
      } else {
        turningStreak = 0;

        if (mad < STABLE_THRESHOLD) {
          // Frame is stable
          if (stableFromTime === null) {
            stableFromTime = t; // just became stable
          } else if (!capturedThisRun) {
            const stableDuration = t - stableFromTime;
            const gapSinceLast   = t - lastCaptureTime;

            if (stableDuration >= STABLE_HOLD_S && gapSinceLast >= MIN_PAGE_GAP_S) {
              // Page has settled — capture the midpoint of the run (avoids
              // leading-edge blur), then stay quiet until the next page turn.
              captureTimestamps.push(stableFromTime + stableDuration / 2);
              lastCaptureTime = t;
              capturedThisRun = true;
            }
          }
        }
        // AMBIGUOUS (between thresholds): preserve current state
      }
    }

    // Post-loop: capture the final stable segment if its run was never captured
    if (
      !capturedThisRun &&
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

    // ── Pass 2: capture pages at full resolution, dropping duplicates ────────
    // Safety net: if two capture timestamps show near-identical content
    // (the same page detected twice), keep only the first.
    const pageFiles: File[] = [];
    let lastKeptPixels: Uint8ClampedArray | null = null;

    for (let i = 0; i < captureTimestamps.length; i++) {
      await seekTo(video, captureTimestamps[i]);
      capCtx.drawImage(video, 0, 0, vw, vh);

      onProgress?.({
        phase: 'capturing',
        pct: Math.round(80 + ((i + 1) / captureTimestamps.length) * 20),
        pagesFound: pageFiles.length,
      });

      // Downscale this capture and compare against the last kept page
      cmpCtx.drawImage(capCanvas, 0, 0, COMPARE_W, COMPARE_H);
      if (lastKeptPixels && computeMAD(cmpCtx, lastKeptPixels) < DUPLICATE_MAD) {
        continue; // same page seen again — skip
      }
      lastKeptPixels = cmpCtx.getImageData(0, 0, COMPARE_W, COMPARE_H).data.slice() as Uint8ClampedArray;

      const blob = await toBlob(capCanvas, JPEG_QUALITY);
      pageFiles.push(new File([blob], `page-${pageFiles.length + 1}.jpg`, { type: 'image/jpeg' }));
    }

    onProgress?.({ phase: 'capturing', pct: 100, pagesFound: pageFiles.length });
    return pageFiles;

  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
