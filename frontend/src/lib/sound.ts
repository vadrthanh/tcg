// Celebratory sound for a Legendary pull.
//
// By default this plays a short fanfare synthesized in-browser with the Web
// Audio API — NO audio file is required, nothing to add, no network request.
//
// If you later drop a real clip into frontend/public/sounds/legendary.mp3 (see
// that folder's README) and want to use it instead, set USE_AUDIO_FILE = true
// below. While it's false we never reference the file, so there's no 404 in the
// console and the app is fully self-contained.
//
// Either path is best-effort: any failure is swallowed so a sound can never
// break the reveal. Must be called from a user gesture (the Open Booster click
// chain qualifies), otherwise browser autoplay policies mute it.

// Flip to true only AFTER adding frontend/public/sounds/legendary.mp3.
const USE_AUDIO_FILE = false;
const FILE_URL = "/sounds/legendary.mp3";

let audioCtx: AudioContext | null = null;

export function playLegendaryFanfare(): void {
  if (USE_AUDIO_FILE) {
    try {
      const a = new Audio(FILE_URL);
      a.volume = 0.6;
      a.play().catch(() => synthFanfare()); // file missing/blocked → synth
      return;
    } catch {
      /* fall through to synth */
    }
  }
  synthFanfare();
}

// A short rising major arpeggio (C5–E5–G5–C6) with a soft bell envelope.
function synthFanfare(): void {
  try {
    type Ctor = typeof AudioContext;
    const Ctx: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const t = now + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      // Quick attack, gentle exponential decay — a clean bell-ish ping.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.6);
    });

    // Bring the master in and let it ring out with the final note.
    master.gain.setValueAtTime(0.6, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 * notes.length + 0.6);
  } catch {
    /* Web Audio unavailable — silently skip. */
  }
}
