# Design System Specification: Hardware Lab

## 1. Overview & Creative North Star
**Creative North Star: The Phosphor Observer**

This design system is not a dashboard; it is a high-fidelity monitoring station for complex synthesis. Drawing inspiration from the vector-based clarity of the Teenage Engineering OP-1 and the high-density data visualization of Serum, this system prioritizes "The Observer" over "The User." 

The interface breaks the standard web grid by utilizing **intentional asymmetry** and **technical density**. It mimics the feel of an oscilloscope—where information is not "presented" on a page, but "rendered" on a cathode-ray tube. This is a read-only environment where visual feedback is the primary product, requiring a signature aesthetic that feels tactile, precise, and alive with real-time data.

---

## 2. Colors: The Neon Void
The color palette is built on a "True Black" foundation to maximize the perceived luminosity of the phosphor accents.

### Core Palette
- **Background (#131313):** The void. All visual weight begins here.
- **Primary / Cyan (#26FEDC):** Used for primary oscillators, signal paths, and high-frequency data.
- **Secondary / Electric Orange (#FF9062):** Reserved for gain, heat, and intensity-based feedback.
- **Tertiary / Acid Green (#A4FF00):** Dedicated to rhythmic elements, LFOs, and timing-based data.

### The "No-Line" Rule
Traditional 1px borders are strictly prohibited for structural sectioning. We define space through **Tonal Transitions**. Use `surface-container-low` (#1B1B1B) to define a module's territory against the `surface` (#131313) background. If a division is required, use a shift in background depth or a change in the grid pattern density—never a solid line.

### Surface Hierarchy & Nesting
Treat the UI as a physical hardware chassis. 
- **Chassis (Background):** #131313.
- **Module Plate (Surface-Container-Low):** #1B1B1B.
- **Data Inset (Surface-Container-Highest):** #353535.
By nesting these tones, you create a "milled" look, as if the data monitors are recessed into a solid piece of hardware.

### Signature Textures
Apply a subtle 2px x 2px dot grid or a horizontal "scanline" overlay at 3% opacity across the entire UI. This provides a tactile "soul" and prevents the deep blacks from feeling digitally empty.

---

## 3. Typography: Technical Precision
We utilize a dual-font system to balance editorial authority with technical readout precision.

- **Headings & Titles (Space Grotesk):** This typeface provides the boutique, hardware-brand feel. Use `display-lg` (3.5rem) with tight letter-spacing for module titles to create an authoritative, "high-end" presence.
- **Technical Data (JetBrains Mono):** All real-time values, frequencies, and telemetry must use this monospaced font. It ensures that shifting numbers don't cause horizontal layout jitter and maintains the "lab equipment" aesthetic.

**Hierarchy Note:** Use `label-sm` (0.6875rem) in JetBrains Mono for all sub-data. Small, legible, and technical.

---

## 4. Elevation & Depth: Tonal Layering
In a "Hardware Lab," elevation isn't about shadows; it’s about **luminosity and recession.**

- **The Layering Principle:** Rather than lifting objects off the page with drop shadows, "sink" them into the interface using `surface-container-lowest` (#0E0E0E). This creates the "Data Well" effect.
- **The "Ghost Border" Fallback:** If a container requires a boundary for complex data separation, use the `outline-variant` token at **15% opacity**. It should be felt, not seen.
- **Glow as Elevation:** Instead of a shadow, use a 4px-8px outer glow (box-shadow) on active data elements (like a pulsing Acid Green signal) using the accent color at 20% opacity. This mimics the light bleed of a real phosphor screen.

---

## 5. Components: The Real-Time Monitor
Traditional buttons and inputs do not exist here. Everything is a visualization of an external state.

### Data Monitors (The "Buttons")
Replace standard buttons with "Signal Blocks."
- **Visuals:** A block using `surface-container-high` (#2A2A2A) with a `primary` (#FFFFFF) JetBrains Mono label.
- **State:** When the external hardware triggers a state, the block should "flash" into its assigned accent color (Cyan, Orange, or Green) with a 0ms attack and a 300ms decay.

### Oscilloscopes & Waveforms
- **Lines:** Use 1px width for all vector paths. 
- **Glow:** Apply a `drop-shadow(0 0 2px color)` to the SVG path to simulate the CRT glow.
- **Grid:** Underlay waveforms with a 10% opacity Cyan grid using the `0.5` spacing scale (0.1rem).

### Status Chips
- **Style:** No background. Use a `ghost border` (15% opacity Cyan) and a Cyan dot.
- **Function:** Indicates active signal paths. If the signal is dead, the chip fades to `on-surface-variant` (#B9CAC4).

### The Telemetry List
- **Constraint:** No dividers. 
- **Spacing:** Use `spacing-4` (0.9rem) between data points.
- **Layout:** Align technical labels (left) and monospaced values (right). Use a thin vertical `primary-container` (#25FEDC) bar on the far left to indicate a "grouped" data module.

---

## 6. Do's and Don'ts

### Do:
- **Use Intentional Asymmetry:** If a module is dense with data on the left, leave a large `spacing-24` (5.5rem) void on the right. This feels like custom boutique hardware.
- **Prioritize Legibility of Data:** Ensure JetBrains Mono technical readouts have enough contrast. Use `on-background` (#E2E2E2) for standard data and accent colors only for "active" or "critical" data.
- **Think in Vectors:** Treat every component as if it were drawn by a plotter or an electron beam.

### Don't:
- **No Rounded Corners:** Set all `border-radius` to `0px`. Hardware is precise and sharp.
- **No Solid Borders:** Never use an opaque 1px border. It breaks the "glow" immersion and makes the UI look like a standard web app.
- **No Drop Shadows:** Standard black drop shadows are forbidden. Depth is achieved via color shifts and luminosity.
- **No Hover States:** This is a read-only hardware monitor. Visual changes should be driven by external data, not mouse position.