# Compose a complete browser clip

Record a demo tab explicitly, stop, trim waiting time, then add sound and motion
in **Video recorder → Music and sound / Camera and transitions**. Preview before
exporting. Existing recordings and silent VP9 WebM exports work unchanged.
Hronaut does not record microphone or website audio.

## Sound

`browser_video` `get` includes `audioAssets` metadata. Original built-ins are
`builtin:ambient` (8-second music bed), `builtin:click` (120 ms), and
`builtin:chime` (800 ms). [Provenance and mixing](VIDEO_AUDIO_PROVENANCE.md)
describes their original synthesis and export rights.

Import a local PCM16 WAV using the editor's native file picker or MCP:

```json
{"workspaceId":"YOUR_WORKSPACE","tabId":"YOUR_TAB","action":"import-audio","audioPath":"/absolute/path/original.wav","audioName":"My music","audioProvenance":"Original composition by me; permitted in this clip."}
```

Use the returned opaque asset ID. Imports require the same `external-request`
capability class as file uploads, with existing workspace, lease, pause and
approval checks. The file must be regular, local, mono/stereo PCM16 WAV at
8–48 kHz, no longer than 120 seconds and no larger than 10 MiB. Each recording
retains up to eight imports totaling 32 MiB. Metadata is stripped; filesystem
paths and raw audio are not returned in asset metadata. Unsupported, malformed,
missing and oversized files fail without changing the composition. Assets stay
in memory with their recording and disappear on discard or tab close.

Use original or licensed audio permitting inclusion in the exported clip. A
website-only playback license does not grant raw-asset redistribution rights.
No paid service, website downloader or external sample library is used.

## Agent composition

For a recording at least six seconds long, this keeps four output seconds:

```json
{
  "workspaceId":"YOUR_WORKSPACE", "tabId":"YOUR_TAB", "action":"edit",
  "clips":[{"startMs":0,"endMs":2000},{"startMs":4000,"endMs":6000}],
  "audio":[
    {"assetId":"builtin:ambient","startMs":0,"endMs":4000,"volume":0.25,"fadeInMs":300,"fadeOutMs":500,"loop":true},
    {"assetId":"builtin:chime","startMs":2800,"endMs":3600,"volume":0.6}
  ],
  "cameras":[{"startMs":300,"endMs":1800,"x":0.7,"y":0.5,"zoom":1.6,"endX":0.6,"endY":0.5,"easeMs":300}],
  "transition":{"durationMs":300},
  "annotations":[{"kind":"text","text":"Choose the next step","placement":"bottom-center","startMs":0,"endMs":6000}]
}
```

`edit` replaces only the supplied arrays/options. `audio: []` removes sound,
`cameras: []` removes motion, and `transition: {"durationMs": 0}` disables cuts.
Audio uses **finished output milliseconds** after trimming. Visual annotations
and cameras use **original source milliseconds**. Trim first; shortening clips
must also shorten any audio events extending beyond the new output duration.

Up to 32 audio events can overlap. Each accepts `offsetMs` into its asset,
linear `volume` from 0 to 1, `fadeInMs`, `fadeOutMs`, and `loop`. A non-looping
event must fit within its asset; looping restarts at the asset beginning after
the first offset segment. Fades must fit within the event. Peaks above 0.95 are
reduced with one constant gain across the whole mix, avoiding hard clipping.
Remove a used asset's events before `remove-audio` with its `assetId`.

Camera centers `x/y` and optional pan destinations `endX/endY` are normalized
0..1 coordinates. Zoom and optional `endZoom` are 1..3. Ordered camera intervals
cannot overlap. `easeMs` (default 300, maximum 2000) eases from and back to the
full frame; crop bounds prevent empty edges. Page highlights, pointers and click
markers follow source pixels; caption and callout cards retain readable screen
positions and sizes. Existing fades, drawing arrows and click pulses compose
with these moves. Cut transitions fade through black without changing duration;
short clips automatically shorten fades. Timing is deterministic, frame-based,
and independent of rendering speed. Lossy encoder bytes need not be identical
across platforms.

`render` creates a playable preview; `export` saves a collision-safe local WebM
with VP9 video and optional stereo 48 kHz Opus audio. An unavailable audio encoder
fails explicitly rather than silently dropping sound. Review both the sound and
visible frames before sharing. `clear` cancels rendering and discards the
recording; canceled MCP requests stop the current export without deleting the
recording. No partial file is saved by a canceled render.
