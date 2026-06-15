# Sounds

## `legendary.mp3` (optional)

Plays when a **Legendary** card flips over on the Open Booster screen.

**You do NOT need this file.** By default the app plays a short fanfare
synthesized in-browser (Web Audio) — zero assets, nothing to add. This file is
purely optional polish.

To use a real clip instead: add `legendary.mp3` here, then set
`USE_AUDIO_FILE = true` in `src/lib/sound.ts`. Until you do that, the file is
never referenced (no 404, no network request).

### What to add

- **File name:** exactly `legendary.mp3` (lowercase), placed in this folder
  (`frontend/public/sounds/legendary.mp3`).
- **Length:** ~1–2 seconds. It plays the instant a Legendary reveals, so keep it
  short and punchy.
- **Vibe:** a triumphant chime / fanfare / "jackpot" sting — bright, rewarding,
  not harsh. Think "rare item obtained".
- **Format:** MP3 (broadest browser support). OGG/WAV also work if you also
  change `FILE_URL` in `src/lib/sound.ts`.
- **Volume:** mastered moderately; the player already caps playback at 60%.
- **Loudness:** avoid a sudden loud transient at 0:00 — it can startle. A tiny
  fade-in (a few ms) is ideal.

### Where to find royalty-free clips

Search "fanfare", "success sting", "level up", "magic chime", or "achievement"
on any of these (check each clip's license — CC0 / royalty-free is safest):

- https://freesound.org (filter by CC0 license)
- https://pixabay.com/sound-effects/ (free for commercial use, no attribution)
- https://mixkit.co/free-sound-effects/win/
- https://opengameart.org (game-oriented, check license per asset)

### After adding the file

1. Put `legendary.mp3` in this folder.
2. Open `src/lib/sound.ts` and change `const USE_AUDIO_FILE = false;` to `true`.
3. Reload. If the file ever fails to load it still falls back to the synth.
