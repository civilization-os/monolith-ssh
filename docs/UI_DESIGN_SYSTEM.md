# MonolithSSH UI Design System

This document is the source of truth for humans and AI coding agents changing the desktop UI.

## Product direction

MonolithSSH is an industrial local-control deck for SSH simulation. It is not a marketing dashboard. The interface combines:

- a dark application shell for navigation and product identity;
- a quiet, light workspace for configuration and data review;
- dark operational surfaces for terminals, live logs, and transport details;
- orange for deliberate actions, green for healthy runtime state, amber for warnings, and red for destructive or failed state.

Prefer controlled density, clear hierarchy, and operational feedback over decorative effects.

## Implementation rules for AI agents

1. Reuse variables from `src/styles/tokens.css`. Do not add raw colors, spacing, radii, shadows, font sizes, z-index values, or transition timings inside page selectors.
2. Add reusable component rules to `components.css`; page-specific composition belongs in `pages.css`; shell geometry belongs in `layout.css`; breakpoints belong in `responsive.css`.
3. Preserve visible labels, keyboard focus, reduced-motion behavior, responsive layouts, and custom-select portal behavior.
4. Use the existing SVG icon system. Do not use emoji as controls or status indicators.
5. Status must never rely on color alone. Pair color with text, an icon, a dot, or a border.
6. Primary actions use `.primary-button`; secondary actions use `.outline-button`; low-emphasis actions use `.link-button`; destructive actions use the existing danger treatment.
7. Use monospace text for addresses, ports, commands, fingerprints, timestamps, versions, identifiers, and compact technical metadata only.
8. New routes must work at 960 px, 820 px, and 680 px breakpoints without horizontal page scrolling.
9. Avoid remounting the terminal for cosmetic or background state changes. An active xterm session is operational state.
10. Keep motion between 160 and 320 ms, use opacity/transform where possible, and respect `prefers-reduced-motion`.

## Surface hierarchy

- Canvas: `--color-canvas`, used behind pages.
- Standard surface: `--color-surface`, used by inputs and quiet regions.
- Raised surface: `--color-surface-raised`, used by cards, tables, and toolbars.
- Shell: `--color-shell`, used by navigation and control-deck bands.
- Terminal: `--color-terminal-background`, used only for command and live-log contexts.

## Review checklist

- The primary task is identifiable within three seconds.
- Running, stopped, warning, failure, and disabled states remain distinguishable without relying only on color.
- Long Chinese/English labels, instance names, addresses, keys, and errors do not overlap controls.
- Empty, loading, error, success, dirty, and busy states are visually accounted for.
- No new raw design values were introduced outside `tokens.css` unless a standards-required literal is documented.
- Focus rings are visible and the page remains usable with keyboard navigation.
