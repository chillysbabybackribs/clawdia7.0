# UI Typography & Input Scale-Up

**Date:** 2026-03-26
**Status:** Approved

## Goal

Make the app feel more comfortable to use by increasing font sizes, border visibility, and input box padding throughout the UI.

## Decisions

| Setting | Before | After |
|---|---|---|
| Input textarea font | 16px | 21px |
| UI labels (model selector, tabs, status) | 11–13px | 14–15px |
| Attachment/metadata small text | 11–12px | 13–14px |
| Message prose | 1rem | unchanged |
| Input border unfocused | 1px @ 0.06 opacity | 1.5px @ 0.12 opacity |
| Input border focused | 1px @ 0.12 opacity | 1.5px @ 0.22 opacity |
| Input border hover | 1px @ 0.09 opacity | 1.5px @ 0.16 opacity |
| Textarea inner padding | px-2 py-2 | px-3 py-3 |
| Input container outer padding | px-4 pb-4 pt-3 | px-5 pb-5 pt-4 |
| Send/action button size | w-9 h-9 (36px) | w-10 h-10 (40px) |

## Files to Change

### `src/renderer/components/InputBar.tsx`

All changes are in one file:

1. **Textarea font size** — change `text-[16px]` to `text-[21px]`
2. **Textarea padding** — change `px-2 py-2` to `px-3 py-3`
3. **Container outer padding** — change `px-4 pb-4 pt-3` to `px-5 pb-5 pt-4`
4. **Border unfocused** — change `border-white/[0.06]` to `border-white/[0.12]`, border width from `1px` to `1.5px`
5. **Border focused** — change `border-white/[0.12]` to `border-white/[0.22]`, border width `1.5px`
6. **Border hover** — change `border-white/[0.09]` to `border-white/[0.16]`
7. **Send button** — change `w-9 h-9` to `w-10 h-10`
8. **Attachment button** — change `w-8 h-8` to `w-9 h-9`
9. **Model selector font** — change `text-[11px]` to `text-[14px]`
10. **Menu items font** — change `text-[13px]` to `text-[15px]`

### `src/renderer/index.css` (if needed)

No global CSS changes expected — all sizing is inline Tailwind in InputBar.tsx.

## Out of Scope

- Message prose font size (already comfortable at 1rem)
- AppChrome title/button sizes (small intentional branding text)
- TabStrip font size (separate component, separate concern)
- Sidebar font sizes
