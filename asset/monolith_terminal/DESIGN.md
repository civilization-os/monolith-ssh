---
name: Monolith Terminal
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1b1b1b'
  on-surface-variant: '#4c4546'
  inverse-surface: '#303030'
  inverse-on-surface: '#f1f1f1'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e1dfdf'
  on-secondary-container: '#626262'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1b1b1b'
  on-tertiary-container: '#848484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#e4e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#f9f9f9'
  on-background: '#1b1b1b'
  surface-variant: '#e2e2e2'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 16px
  margin: 24px
---

## Brand & Style
This design system is built on a philosophy of **Functional Minimalism**, blending the raw utility of a command-line interface with the refined elegance of modern editorial design. It is tailored for developers and system administrators who value clarity and precision over visual noise.

The style is characterized by "Invisible UI"—where the interface recedes to let the content and commands take center stage. It utilizes a predominantly monochrome palette, relying on thin strokes, purposeful white space, and typographic hierarchy rather than heavy fills or vibrant colors. The emotional response is one of calm, professional focus and high-performance efficiency.

## Colors
The palette is strictly curated to eliminate distraction. 
- **Primary:** High-contrast Black (#000000) is reserved for primary text, active states, and structural underlines.
- **Secondary:** A Deep Gray (#666666) is used for secondary information and inactive metadata.
- **Neutral/Background:** Pure White (#FFFFFF) provides a clean canvas, while a very subtle Off-White (#F9F9F9) differentiates container surfaces.
- **Accents:** Feedback should be communicated through weight and underlines rather than hue. If functional status is required, use a single muted semantic color (e.g., a desaturated green for 'connected').

## Typography
The system uses **Inter** for its neutral, highly legible character in UI elements and **JetBrains Mono** for technical output and terminal simulations. 

Hierarchy is established through weight and deliberate vertical spacing. For mobile views, `headline-lg` should scale down to 24px. Ensure all "terminal" output uses the monospaced variable to maintain character alignment and technical authenticity.

## Layout & Spacing
The layout follows a strict 8px rhythmic grid. Content is housed in a fixed-width central column (1200px max) for desktop to ensure line lengths remain readable for logs and code.

- **Desktop:** 12-column grid with 24px margins and 16px gutters.
- **Tablet:** 8-column grid with 24px margins.
- **Mobile:** 4-column grid with 16px margins. 

Padding within terminal blocks should be a consistent 24px to provide "breathing room" against the dense monospaced text.

## Elevation & Depth
Depth is created through "Soft Layering" rather than physical height. 
- **Tier 0 (Background):** Pure White (#FFFFFF).
- **Tier 1 (Cards/Containers):** Very light gray surface (#F9F9F9) with a 1px border (#EEEEEE). 
- **Shadows:** Use a single, extremely diffused ambient shadow for floating elements (e.g., dropdowns): `0px 4px 20px rgba(0, 0, 0, 0.04)`.
- **Focus:** No heavy drop shadows are used for interaction. Instead, focus is indicated by a 2px black underline or a subtle shift in the background color of the container.

## Shapes
The design system uses a "Soft" rounding approach. 
- **Standard (4px):** Used for input fields, buttons, and small UI components.
- **Large (8px):** Used for main terminal windows and content cards.
This subtle rounding softens the clinical nature of the monochrome palette without losing the professional, structured feel of the simulator.

## Components

### Buttons
Buttons should avoid heavy fills. Use a "Ghost-Link" style: no background, black text, and a 1px black underline that appears on hover or remains persistent for primary actions. For high-priority destructive actions, a subtle 1px border is permissible.

### Input Fields (Command Line)
Inputs should resemble a classic terminal prompt. Remove all borders except for a bottom 1px stroke (#000000). Use a flashing block cursor or a simple vertical line.

### Cards
Cards are used to group server instances or session details. They should have a #F9F9F9 background, 8px corner radius, and a 1px #EEEEEE border. No shadows unless the card is being "dragged" or "active."

### Terminal Window
The core component. It should feature a thin header bar with simple dots for window controls (no icons). The internal area uses JetBrains Mono on a White or extremely light gray background.

### Iconography
Icons must use 1px or 1.5px stroke weights. They should be strictly linear, avoiding any filled shapes unless used for a toggle "on" state. Size should be locked to 20px or 24px viewboxes.