# Agent Sidebar + Video Extractor — Design Spec

**Date:** 2026-03-26

---

## Overview

Replace the existing two-part sidebar (48px icon rail + 210px drawer) with a single unified 300px `AgentSidebar`. The sidebar houses preconfigured agents as accordion cards stacked top-to-bottom. The first agent is a Video Extractor powered by yt-dlp.

---

## Sidebar Structure

**Removed:**
- `Rail.tsx` — deleted
- `Sidebar.tsx` — gutted and replaced
- All 7 drawer components (`ChatDrawer`, `AgentsDrawer`, `BrowserDrawer`, `FilesDrawer`, `DesktopDrawer`, `WalletDrawer`, `TasksDrawer`) — stop rendering; files left on disk

**New components:**
- `src/renderer/components/AgentSidebar.tsx` — 300px fixed panel, manages accordion open/close state (only one card open at a time)
- `src/renderer/components/agents/VideoExtractorAgent.tsx` — accordion card component

**Integration:**
- `src/renderer/App.tsx` — replace `<Sidebar />` with `<AgentSidebar />`, remove all sidebar-related props and callbacks

---

## Agent Card Layout

Each agent is an accordion card. Collapsed: header row only. Expanded (top to bottom):

1. **Header row** — emoji icon + agent name + chevron (▲/▼), click to toggle
2. **Chat-style input box** — textarea placeholder "Paste a URL or describe the video..."; Run ▶ button vertically centered on the right inside the box
3. **Folder picker row** — 📁 icon + current path + Browse button (opens Electron folder dialog)
4. **Options row** — 3 inline dropdowns side by side:
   - **Quality:** Best (default), 1080p, 720p, 480p, 360p
   - **Format:** MP4 (default), WebM, MKV
   - **Audio:** Video (default), Audio only, MP3, M4A, OPUS
5. **Status area** — hidden by default, appears on run:
   - Progress bar + percentage
   - Current filename being downloaded
   - On complete: "Done — saved to [filepath]"
   - On error: error message in red

---

## Video Extractor — Execution Logic

### Input Detection
- If input matches a URL pattern (`http://`, `https://`, or known domain) → execute yt-dlp directly
- If input is natural language → open browser pane, perform search, display results for user to select from, then proceed to download

### yt-dlp Command
Built from selected dropdown values:
- Quality maps to yt-dlp `-f` format selectors (e.g., `bestvideo+bestaudio`, `bestvideo[height<=1080]+bestaudio`)
- Format maps to `--merge-output-format` or `--extract-audio --audio-format`
- Audio only triggers `--extract-audio` with the selected codec
- Output directory set via `-o "[folder]/%(title)s.%(ext)s"`

### yt-dlp Availability Check
On first Run click: check if `yt-dlp` is on PATH via `which yt-dlp`. If not found, show inline prompt in the status area: "yt-dlp not found — install it?" with an Install button. Install runs `pip install yt-dlp` or `pip3 install yt-dlp` via shell.

### Progress Streaming
yt-dlp is spawned via Node.js `child_process.spawn`. stdout is piped line-by-line and parsed for progress percentage and filename. Each line is sent to the renderer via IPC.

---

## IPC Interface

**Renderer → Main:**
- `start-download` — `{ url: string, outputDir: string, quality: string, format: string, audio: string }`
- `check-ytdlp` — no args, returns `{ installed: boolean }`
- `install-ytdlp` — no args, streams install progress
- `open-folder-dialog` — no args, returns `{ path: string | null }`

**Main → Renderer:**
- `download-progress` — `{ percent: number, line: string }`
- `download-complete` — `{ filePath: string }`
- `download-error` — `{ message: string }`

**New file:** `src/main/ipc/videoExtractor.ts` — registers all handlers above, imported and wired in `src/main/main.ts`.

---

## Files Changed

| File | Action |
|------|--------|
| `src/renderer/components/AgentSidebar.tsx` | Create |
| `src/renderer/components/agents/VideoExtractorAgent.tsx` | Create |
| `src/main/ipc/videoExtractor.ts` | Create |
| `src/renderer/App.tsx` | Modify — swap Sidebar for AgentSidebar |
| `src/main/main.ts` | Modify — register videoExtractor IPC handlers |
| `src/renderer/components/Sidebar.tsx` | Delete (rendering removed) |
| `src/renderer/components/sidebar/Rail.tsx` | Delete |

---

## Constraints

- No new npm packages — yt-dlp is a system binary called via Node's `child_process`
- yt-dlp install is optional and user-initiated, never automatic
- Sidebar width: 300px fixed
- Only one accordion card open at a time
