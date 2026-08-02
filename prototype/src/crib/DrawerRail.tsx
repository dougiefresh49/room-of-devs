import { Tabs, TabsContent, TabsList, TabsTrigger } from "@room/ui";
import { drawerLabels } from "./crib-manifest";

export type DrawerTab = ReturnType<typeof drawerLabels>[number]["id"];

export function DrawerRail({
  drawer,
  onDrawerChange,
}: {
  drawer: DrawerTab;
  onDrawerChange: (id: DrawerTab) => void;
}) {
  const labels = drawerLabels();
  return (
    <Tabs
      value={drawer}
      onValueChange={(v) => onDrawerChange(v as DrawerTab)}
      orientation="horizontal"
      activationMode="automatic"
      className="crib-rail-tabs"
    >
      <TabsList className="crib-rail-list" aria-label="Crib drawers">
        {labels.map((row) => (
          <TabsTrigger
            key={row.id}
            value={row.id}
            className={`crib-drawer${row.id === "dead-stock" ? " crib-drawer--dead" : ""}${row.id === "work-orders" ? " crib-drawer--orders" : ""}`}
          >
            <span className="crib-drawer-pull" aria-hidden />
            <span className="crib-drawer-label">{row.label}</span>
            <span className="crib-drawer-cnt">{row.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {labels.map((row) => (
        <TabsContent key={row.id} value={row.id} hidden />
      ))}
    </Tabs>
  );
}
