# Design QA — Routeva 0.7.1

## Evidence

- Source state 1: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\01-source-country-mismatch.png`
- Source state 2: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\02-source-foreground-flag.png`
- Final popup: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\03-implementation-popup.png`
- Search open: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\04-implementation-search-v3.png`
- Final settings: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\05-implementation-options.png`
- Focused before/after comparison: `C:\Users\dimar\OneDrive\Документы\Amnezia Extension\artifacts\audit\06-comparison-card.png`
- Browser/state: Brave, popup 380 × 650/760, 286 Gateway nodes, selected-sites mode; settings 920 × 900.

## Findings and fixes

- P1 — the foreground flag competed with protocol and power controls. Removed; the country remains visible as the full-card background.
- P1 — selecting a node caused an optimistic render, a second server response render and a success toast. Selection now waits for one response and performs one render; the toast is gone.
- P1 — the card played an entrance animation during opening and every selection. The animation and focus ring on the whole card were removed; card height is fixed at 222 px.
- P1 — a stored IP result could survive a Gateway switch. Each switch now resets the selected node location, increments the PAC revision, rotates the IP-check host and probes after the Gateway confirms the node.
- P1 — 286 nodes were impractical to browse one by one. Added an always-visible search by node name, country and protocol with up to eight concise results.
- P2 — settings mixed editable connection profiles with hundreds of subscription nodes. The selector is now “Профиль подключения” and lists only editable base connections; Gateway nodes are chosen in the popup.
- P2 — repeated Gateway explanations increased visual noise. The requested status and compatibility blocks were removed.
- No actionable P0–P2 visual findings remain.

## Interaction and accessibility checks

- Previous/next remain native buttons with accessible names and disabled edge states.
- Search has a visible label through its placeholder, native search semantics, an accessible clear button, Escape-to-close and keyboard-focusable result buttons.
- Server result rows expose the selected state with `aria-selected` and show both country and protocol.
- The popup no longer moves focus to the status card on open.
- Screenshot review can confirm visible contrast and clipping, but not full screen-reader output or every system zoom level.

## Final result

passed
