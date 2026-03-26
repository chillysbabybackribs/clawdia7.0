# Premium Tab Redesign

**Date:** 2026-03-26
**Status:** Approved

## Goal

Redesign conversation tabs (TabStrip) and browser tabs (BrowserPanel) to be larger, more legible, and visually premium — using an underline indicator style consistent with the input box's dark surface and defined border language. Also update the AppChrome brand text to match the blue accent.

## Decisions

| Setting | Before | After |
|---|---|---|
| Chat tab height | 22px | 46px |
| Chat tab font size | 11px | 15px |
| Chat tab font weight | normal | 500 |
| Chat tab label | number only ("1") | "Chat N" |
| Chat tab padding | px-2.5 | px-[18px] |
| Chat active indicator | border + bg fill | border-bottom 2.5px #4a9eff |
| Chat dot indicator | none | 8px circle #4a9eff on active tab |
| Chat inactive text | text-text-muted | rgba(255,255,255,0.30) |
| Chat close button size | text × | 15px ×, visible on active/hover |
| New tab (+) button | w-5 h-[22px] text-[14px] | h-[46px] px-[10px] text-[20px] |
| Tab strip height | h-6 (24px) | h-[46px] |
| Browser tab height | 32px | 46px |
| Browser tab font size | 12px | 14px |
| Browser tab font weight | 500 | 500 |
| Browser tab padding | px-3 | px-[16px] |
| Browser active indicator | bg-surface-3 + shadow | border-bottom 2.5px #4a9eff |
| Browser favicon size | w-4 h-4 (16px) | w-[16px] h-[16px] (unchanged) |
| Browser close button | opacity-0 group-hover:opacity-60 | same behavior, size unchanged |
| Browser new tab (+) | w-7 h-7 rounded-xl | h-[46px] px-[10px], same icon |
| AppChrome brand text color | #7a3b10 (amber/brown) | #4a9eff (blue accent) |

## Accent Color

`#4a9eff` — used for:
- Active tab underline (`border-bottom: 2.5px solid #4a9eff`)
- Active tab dot indicator
- AppChrome "Clawdia" + "Workspace" text

## Files to Change

### `src/renderer/components/TabStrip.tsx`

- Outer container: `h-6 flex items-end` → `h-[46px] flex items-center`, add `border-b border-white/[0.06]` to the container
- Remove the `absolute inset-x-0 bottom-0 h-px bg-border-subtle` bottom border div (no longer needed)
- Each tab:
  - Height: `h-[22px]` → `h-[46px]`
  - Padding: `px-2.5` → `px-[18px]`
  - Font: `text-[11px]` → `text-[15px] font-medium`
  - Gap: `gap-1` → `gap-[7px]`
  - Label: `{index + 1}` → `Chat {index + 1}`
  - Active state: remove `bg-surface-1 border border-b-0 border-white/[0.10] z-10` → add `border-b-[2.5px] border-[#4a9eff] text-text-primary`
  - Active state: add blue dot `<span className="w-2 h-2 rounded-full bg-[#4a9eff] flex-shrink-0" />` before label
  - Inactive state: `text-text-muted hover:text-text-secondary` → `text-white/30 hover:text-white/60 border-b-[2.5px] border-transparent`
  - Close button: `text-[×]` stays, but ensure visible on active tab and on group-hover
- New tab button: `w-5 h-[22px] text-[14px]` → `h-[46px] px-[10px] text-[20px]`, remove fixed width

### `src/renderer/components/BrowserPanel.tsx`

- Tab strip container (line ~239): `h-[40px]` → `h-[46px]`
- Each browser tab div (line ~245):
  - Height: `h-[32px]` → `h-[46px]`
  - Padding: `px-3` → `px-[16px]`
  - Active state: remove `bg-surface-3 shadow-[...]` → add `border-b-[2.5px] border-[#4a9eff] text-text-primary`
  - Inactive state: keep `text-text-tertiary hover:text-text-secondary`, add `border-b-[2.5px] border-transparent hover:bg-white/[0.03]`
  - Font size: `text-[12px]` → `text-[14px]`
- New tab button (line ~268): `w-7 h-7 rounded-xl` → `h-[46px] px-[10px]`, remove fixed width/height, keep icon and colors

### `src/renderer/components/AppChrome.tsx`

- Brand text color: `style={{ color: '#7a3b10' }}` → `style={{ color: '#4a9eff' }}`

## Out of Scope

- Tab strip background color (stays `bg-surface-1` / `#0d0d12`)
- URL bar styling in BrowserPanel
- Navigation button sizes in BrowserPanel
- Sidebar or other component fonts
