# Video audio provenance and mixing

The three built-in sounds are original Hronaut compositions synthesized by
`generateVideoAudioBuiltin` in `src/shared/video-audio.ts`. They contain no
downloaded recordings, third-party samples, purchased stock, or external assets.

| Asset | Composition | Duration |
| --- | --- | --- |
| `builtin:ambient` | Quiet C-major sine pad with a smooth repeating envelope | 8 seconds |
| `builtin:click` | Short damped 760 Hz tone with a second harmonic | 120 milliseconds |
| `builtin:chime` | 880 Hz tone with a 1320 Hz overtone and a gentle decay | 800 milliseconds |

They were created for this application on September 30, 2026. Generation is
deterministic, local, and independent of random seeds or a network service.
Exported clips can include these sounds. There are no third-party attribution or
raw-asset redistribution conditions attached to these original sounds.

Imported assets remain the user's responsibility: use original audio or a license
that permits its use in the intended exported clip. A website playback license
does not necessarily permit raw asset redistribution. Hronaut neither downloads
audio from websites nor bundles imported material into the application.

Import accepts bounded PCM16 RIFF/WAVE only: mono or stereo, 8–48 kHz, at most
two minutes and 10 MiB per file. Normalization discards all container metadata.
Other codecs, malformed headers, inconsistent sample sizes, duplicate format/data
chunks, and truncated files are rejected. No file path reaches the export renderer.

Mixing resamples linearly to stereo 48 kHz. Event timing refers to the edited
output timeline, including after trims. Non-looping events must fit inside their asset; looping events repeat from the asset beginning after the first
offset segment. Volume is linear from zero to one. Fade durations are linear;
two-millisecond safety ramps at event and asset edges prevent abrupt clicks.
Overlapping events sum together. If their combined peak exceeds 0.95, a single
constant gain scales the whole mix to 0.95, preserving dynamics without hard
clipping or pumping. This leaves headroom for lossy Opus encoding; encoded peaks
can differ slightly from the PCM source.

Exports with audio use the runtime's Opus encoder at 128 kb/s. Audio-free exports
retain their existing behavior. An unavailable encoder fails explicitly rather
than silently dropping the requested soundtrack.
