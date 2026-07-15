# Design QA — Routeva popup 0.6.0

## Evidence

- Source visual truth:
  - `C:\Users\dimar\AppData\Local\Temp\codex-clipboard-296faa9a-7180-4f39-a9cd-ca67b3f9258a.png`
  - `C:\Users\dimar\AppData\Local\Temp\codex-clipboard-01285a0a-ae0d-4b0a-a0a6-13dbd05d7079.png`
  - `C:\Users\dimar\AppData\Local\Temp\codex-clipboard-86240bbf-83c9-47c1-a0f2-2487cbed3d98.png`
- Implementation screenshot: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\popup-0.6.0-routeva.png`
- Combined full/focused comparison: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\popup-0.6.0-comparison.png`
- Options screenshot: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\options-0.6.0-routeva.png`
- Viewport/state: popup 380 × 700, active Netherlands server, selected-sites mode; all-internet mode also exercised.

## Fidelity review

- Fonts and typography: Segoe UI Variable hierarchy remains consistent; the status title, server name, secondary location and control labels retain clear optical weights without clipping.
- Spacing and layout rhythm: HTTPS, flag and power switch are now exactly 50 × 30, share one baseline and use consistent six-pixel gaps. Card radius, internal padding and bottom metadata rhythm remain intact.
- Colors and visual tokens: the real country flag is enlarged behind the card, blurred and darkened by a green overlay. White text and mint status labels preserve strong contrast.
- Image quality and asset fidelity: the local SVG flag remains sharp in the foreground; the same real flag asset provides the soft full-card backdrop without stretching artifacts in the readable foreground control. The approved generated Routeva route mark is used consistently for the browser and interface icons.
- Copy and content: the product is renamed Routeva and the subtitle now reads “VPN и прокси по вашим правилам”. The settings action is explicit instead of relying on an ambiguous gear.
- Responsiveness/accessibility: the popup has no horizontal overflow; controls preserve focus styles and accessible labels. Options also report no horizontal overflow at the checked width.

## Comparison history

- Earlier P1 — controls looked unrelated because HTTPS, flag and switch had different heights and visual weight. Fixed by normalizing all three to 50 × 30 and aligning them in one row. Post-fix evidence is the focused controls row in the combined comparison.
- Earlier P2 — the flat green card did not visually communicate the selected country. Fixed by reusing the real country flag as a blurred, low-opacity background with a dark overlay. Post-fix evidence is the card comparison at identical 340 × 222 crops.
- Earlier P2 — the small square gear was unclear and visually detached from the minimal header. Fixed with a quiet capsule button labelled “Настройки”. Post-fix evidence is the settings comparison row.
- No actionable P0–P2 findings remain for the supplied card and settings-button targets.

## Primary interactions checked

- Selected-sites → all-internet mode switches successfully.
- All-internet mode updates card copy/count/footer and disables the community list.
- Settings button navigates to the Routeva options page.
- Browser console errors checked: none.

## Final result

passed
