import { useMemo, useState } from "react";
import { Chassis, CutFrame, ScreenBed, Tag, TooltipProvider } from "@room/ui";
import { ControlDeck } from "../deck/ControlDeck";
import type { DrawerTab } from "./DrawerRail";
import { DrawerRail } from "./DrawerRail";
import { InstrumentCard } from "./InstrumentCard";
import { DeadStockBin } from "./DeadStockBin";
import { WorkOrders } from "./WorkOrders";
import { SpecPlate } from "./SpecPlate";
import { SurfaceFilterPins } from "./crib-chrome";
import {
  deadStockCount,
  fragileCount,
  instruments,
  type Instrument,
  type Surface,
} from "./crib-manifest";

function matchesDrawer(inst: Instrument, drawer: DrawerTab): boolean {
  if (drawer === "all") return true;
  if (drawer === "dead-stock") return inst.consumers.length === 0;
  if (drawer === "work-orders") return false;
  return inst.drawer === drawer;
}

export function CribView() {
  const [drawer, setDrawer] = useState<DrawerTab>("all");
  const [query, setQuery] = useState("");
  const [surfaceFilter, setSurfaceFilter] = useState<Set<Surface>>(new Set());
  const [selectedId, setSelectedId] = useState<string>(instruments[0]?.id ?? "");
  const [plateOpen, setPlateOpen] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return instruments.filter((inst) => {
      if (!matchesDrawer(inst, drawer)) return false;
      if (surfaceFilter.size > 0 && !inst.surfaces.some((s) => surfaceFilter.has(s))) return false;
      if (!q) return true;
      return (
        inst.name.toLowerCase().includes(q) ||
        inst.id.toLowerCase().includes(q) ||
        inst.path.toLowerCase().includes(q)
      );
    });
  }, [drawer, query, surfaceFilter]);

  const selected = instruments.find((i) => i.id === selectedId) ?? filtered[0] ?? null;

  const toggleSurface = (surface: Surface) => {
    setSurfaceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(surface)) next.delete(surface);
      else next.add(surface);
      return next;
    });
  };

  const showCatalog = drawer !== "dead-stock" && drawer !== "work-orders";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="proto-app proto-app--crib">
        <div className="haz" style={{ marginBottom: 18 }} />
        <CutFrame scale="l" className="crib-shell-wrap">
          <Chassis className="crib-shell">
            <header className="crib-head">
              <span className="crib-title">THE TOOL CRIB // COMPONENT LIBRARY</span>
              <Tag tone="dim">ROUTE /crib · PORT 5180 · NO STORE ACCESS</Tag>
              <span className="crib-head-spacer" />
              <span className="crib-head-meta">
                ◂ RENDERED FROM crib-manifest.ts · {instruments.length} INSTRUMENTS ·{" "}
                <span className="crib-meta-fragile">{fragileCount()} FRAGILE</span> ·{" "}
                <span className="crib-meta-dead">{deadStockCount()} DEAD STOCK</span>
              </span>
            </header>

            <div className="crib-grid">
              <aside className="crib-rail">
                <ScreenBed className="crib-search">
                  <label className="crib-search-label">
                    <span aria-hidden>▸</span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="SEARCH THE CRIB…"
                      className="crib-search-input"
                    />
                  </label>
                </ScreenBed>
                <DrawerRail drawer={drawer} onDrawerChange={setDrawer} />
                <SurfaceFilterPins active={surfaceFilter} onToggle={toggleSurface} />
                <div className="crib-rail-note">
                  <div className="crib-rail-note-title">Dead-stock detector</div>
                  <p>
                    Generated manifest unions exports and scans every named import whose source begins with{" "}
                    <code>@room/ui</code>, plus the prototype rig extensions. Catalog-only specimens are excluded.
                    Zero hits ⇒ red lamp. Counts render from the file — never hardcoded in JSX.
                  </p>
                </div>
              </aside>

              <main className="crib-main">
                {drawer === "dead-stock" ? (
                  <DeadStockBin />
                ) : drawer === "work-orders" ? (
                  <WorkOrders />
                ) : (
                  <div className="crib-cardsgrid">
                    {filtered.map((inst) => (
                      <InstrumentCard
                        key={inst.id}
                        instrument={inst}
                        selected={selected?.id === inst.id}
                        onSelect={() => setSelectedId(inst.id)}
                      />
                    ))}
                    {filtered.length === 0 ? (
                      <div className="crib-empty">NO INSTRUMENTS MATCH THIS FILTER.</div>
                    ) : null}
                  </div>
                )}
              </main>

              {showCatalog ? (
                <aside className="crib-spec-col">
                  <SpecPlate instrument={selected} open={plateOpen} onOpenChange={setPlateOpen} />
                </aside>
              ) : (
                <aside className="crib-spec-col">
                  <SpecPlate instrument={null} open={false} onOpenChange={() => {}} />
                </aside>
              )}
            </div>
          </Chassis>
        </CutFrame>
        <ControlDeck />
      </div>
    </TooltipProvider>
  );
}
