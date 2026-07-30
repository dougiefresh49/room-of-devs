import { createRoot } from "react-dom/client";
import "../src/tokens.css";
import "../src/rig.css";
import {
  Bay,
  Chassis,
  CrtFace,
  CutFrame,
  DialGauge,
  HexLayer,
  Keycap,
  Led,
  Odometer,
  SalienceBar,
  ScreenBed,
  Tag,
} from "../src/rig/index.js";
import type { CrtFaceSize } from "../src/rig/index.js";
import mikey from "./assets/mikey-idle.png";
import "./gallery.css";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="g-sec">
      <h2>{title}</h2>
      <div className="g-row">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="g-label">{children}</div>;
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="g-card">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const CRT_SIZES: CrtFaceSize[] = [26, 52, 58, 104, 158, 176];

function Gallery() {
  return (
    <div className="rig g-page">
      <header className="g-mast">
        <div className="g-haz" />
        <h1>RIG // PRIMITIVES</h1>
        <p>Dev-only gallery — every state, every scale. Not shipped.</p>
      </header>

      <Section title="CutFrame ×3 scales">
        {(["l", "m", "s"] as const).map((scale) => (
          <Card key={scale} label={`scale=${scale}`}>
            <CutFrame
              scale={scale}
              glow="0 0 16px rgba(255,150,30,.35)"
              style={{ width: scale === "l" ? 220 : scale === "m" ? 180 : 140 }}
              innerClassName="g-cut-demo"
            >
              <div className="g-cut-fill">CUT {scale.toUpperCase()}</div>
            </CutFrame>
          </Card>
        ))}
      </Section>

      <Section title="Chassis">
        <Card label="plain">
          <Chassis>
            <div className="g-pad">gunmetal panel</div>
          </Chassis>
        </Card>
        <Card label="screws">
          <Chassis screws>
            <div className="g-pad">riveted · BR clears chamfer</div>
          </Chassis>
        </Card>
      </Section>

      <Section title="Bay">
        <Card label="label + meta">
          <Bay label="THE SPINE" meta="ENERGIZED">
            <div className="g-muted">bay body slot</div>
          </Bay>
        </Card>
        <Card label="screws">
          <Bay label="PLOT BAY" meta="T-0451" screws>
            <div className="g-muted">with corner rivets</div>
          </Bay>
        </Card>
      </Section>

      <Section title="ScreenBed">
        <Card label="plain">
          <ScreenBed>
            <div className="g-pad">CRT bed</div>
          </ScreenBed>
        </Card>
        <Card label="hex">
          <ScreenBed hex>
            <div className="g-pad">+ faint hex</div>
          </ScreenBed>
        </Card>
        <Card label="scanlines">
          <ScreenBed scanlines>
            <div className="g-pad">+ scanlines</div>
          </ScreenBed>
        </Card>
        <Card label="hex + scan + sweep">
          <ScreenBed hex scanlines sweep>
            <div className="g-pad">full ambience</div>
          </ScreenBed>
        </Card>
      </Section>

      <Section title="Tag tones">
        {(["amber", "red", "green", "dim"] as const).map((tone) => (
          <Card key={tone} label={tone}>
            <Tag tone={tone}>{tone.toUpperCase()}</Tag>
          </Card>
        ))}
      </Section>

      <Section title="Led tones / pulses">
        <Card label="amber pulse">
          <Led tone="amber" pulse />
        </Card>
        <Card label="amber hot .5s">
          <Led tone="amber" pulse pulseSpeed="hot" />
        </Card>
        <Card label="red pulse 1.1s">
          <Led tone="red" pulse />
        </Card>
        <Card label="green static">
          <Led tone="green" />
        </Card>
        <Card label="dim">
          <Led tone="dim" />
        </Card>
      </Section>

      <Section title="Keycap">
        <Card label="idle">
          <Keycap glyph="A" label="APPROVE" hint="say approve" />
        </Card>
        <Card label="armed">
          <Keycap glyph="B" label="SHIP IT" hint="say ship it" armed />
        </Card>
      </Section>

      <Section title="HexLayer intensities">
        {(["bright", "dim", "faint"] as const).map((intensity) => (
          <Card key={intensity} label={intensity}>
            <div className="g-hex-stage">
              <HexLayer intensity={intensity} banded={intensity === "bright"} />
            </div>
          </Card>
        ))}
      </Section>

      <Section title="Odometer">
        <Card label="amber rolling">
          <Odometer value={12480} digits={5} tone="amber" rolling />
        </Card>
        <Card label="steel static">
          <Odometer value={37} digits={3} tone="steel" rolling={false} />
        </Card>
      </Section>

      <Section title="DialGauge">
        <Card label="41% fill">
          <DialGauge
            fraction={0.41}
            caption={
              <>
                ELEVENLABS · MONTH
                <br />
                <b>$4.10 / $10 CAP</b>
              </>
            }
          />
        </Card>
        <Card label="23% + redline">
          <DialGauge
            fraction={0.23}
            redlineFrom={0.85}
            caption={
              <>
                GEMINI · TODAY
                <br />
                <b>37 CALLS · REDLINE 160</b>
              </>
            }
          />
        </Card>
      </Section>

      <Section title="CrtFace sizes">
        {CRT_SIZES.map((size) => (
          <Card key={size} label={`${size}px${size === 176 ? " +halo" : ""}`}>
            <CrtFace size={size} halo={size === 176}>
              <img src={mikey} alt="" />
            </CrtFace>
          </Card>
        ))}
      </Section>

      <Section title="SalienceBar">
        <Card label="lit=10 · th=5 (35%)">
          <SalienceBar segments={16} lit={10} threshold={5} />
        </Card>
        <Card label="lit=3 · th=5 (below)">
          <SalienceBar segments={16} lit={3} threshold={5} />
        </Card>
        <Card label="full clear">
          <SalienceBar segments={16} lit={16} threshold={5} />
        </Card>
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
