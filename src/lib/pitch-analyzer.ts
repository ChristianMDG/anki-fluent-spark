export interface PitchPoint {
  time: number;
  timeLabel: string;
  pitch: number | null;
}

export interface PitchAnalysisResult {
  data: PitchPoint[];
  pitchRange: number;
  validPointCount: number;
  hint: string;
  isFlat: boolean;
}

/**
 * Decodes audio blob and runs a time-domain autocorrelation pitch extraction.
 * Processes 50ms frames and extracts fundamental frequency (F0) in Hz between 70Hz - 400Hz.
 */
export async function analyzePitchContour(blob: Blob): Promise<PitchAnalysisResult> {
  const arrayBuffer = await blob.arrayBuffer();
  
  // Use web audio context for decoding
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }

  const pcm = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  const frameStepSec = 0.05; // 50ms per point
  const windowSize = 2048;
  const minHz = 70;
  const maxHz = 400;

  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.ceil(sr / minHz);

  const data: PitchPoint[] = [];
  const validPitches: number[] = [];

  for (let t = 0; t < duration; t += frameStepSec) {
    const startSample = Math.floor(t * sr);
    if (startSample + windowSize > pcm.length) break;

    // Calculate energy / RMS
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const v = pcm[startSample + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / windowSize);

    // Silence threshold check
    if (rms < 0.012) {
      data.push({
        time: Number(t.toFixed(2)),
        timeLabel: `${t.toFixed(1)}s`,
        pitch: null,
      });
      continue;
    }

    // Autocorrelation search
    let bestLag = -1;
    let maxCorr = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      let energyLag = 0;
      for (let i = 0; i < windowSize - lag; i++) {
        const a = pcm[startSample + i];
        const b = pcm[startSample + i + lag];
        corr += a * b;
        energyLag += b * b;
      }

      const norm = Math.sqrt(sumSq * energyLag) || 1;
      const r = corr / norm;

      if (r > maxCorr) {
        maxCorr = r;
        bestLag = lag;
      }
    }

    // Periodicity / voicing threshold
    if (maxCorr > 0.35 && bestLag > 0) {
      const hz = Math.round(sr / bestLag);
      if (hz >= minHz && hz <= maxHz) {
        data.push({
          time: Number(t.toFixed(2)),
          timeLabel: `${t.toFixed(1)}s`,
          pitch: hz,
        });
        validPitches.push(hz);
      } else {
        data.push({
          time: Number(t.toFixed(2)),
          timeLabel: `${t.toFixed(1)}s`,
          pitch: null,
        });
      }
    } else {
      data.push({
        time: Number(t.toFixed(2)),
        timeLabel: `${t.toFixed(1)}s`,
        pitch: null,
      });
    }
  }

  if (validPitches.length < 3) {
    return {
      data,
      pitchRange: 0,
      validPointCount: validPitches.length,
      hint: "Recording too short or quiet to evaluate pitch contour.",
      isFlat: true,
    };
  }

  // Calculate 10th and 90th percentile to ignore transient spikes/glitches
  const sorted = [...validPitches].sort((a, b) => a - b);
  const p10Index = Math.floor(sorted.length * 0.1);
  const p90Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));

  const p10 = sorted[p10Index];
  const p90 = sorted[p90Index];
  const pitchRange = p90 - p10;

  const isFlat = pitchRange < 40;
  const hint = isFlat
    ? "Your intonation sounds fairly flat — try emphasizing key words more."
    : "Good pitch variation — that's what makes speech sound natural.";

  return {
    data,
    pitchRange,
    validPointCount: validPitches.length,
    hint,
    isFlat,
  };
}
