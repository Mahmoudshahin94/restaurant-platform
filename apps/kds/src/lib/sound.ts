/**
 * New-ticket chime, synthesized with Web Audio (no audio files to ship). Browsers only allow
 * sound after a user gesture, so the screen shows a one-tap "turn on sound" button until then.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  context ??= new AudioContext();
  return context;
}

export function soundUnlocked(): boolean {
  return audio()?.state === 'running';
}

/** Call from a click handler. */
export async function unlockSound(): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state !== 'running') await ctx.resume();
  return ctx.state === 'running';
}

/** Two short rising tones: distinct from kitchen noise, not alarming. */
export function playChime(): void {
  const ctx = audio();
  if (ctx?.state !== 'running') return;
  const start = ctx.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = start + index * 0.18;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.18);
  });
}
