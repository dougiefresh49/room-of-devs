import type { Provenance } from "./crib-manifest";

export function provenanceLabel(p: Provenance): string {
  switch (p.kind) {
    case "custom":
      return "FORGED IN-HOUSE";
    case "radix":
      return `RADIX ▸ ${p.base}`;
    case "cva":
      return "CVA · NO RADIX";
    case "lib":
      return `LIB ▸ ${p.base}`;
  }
}

export function provenanceClass(p: Provenance): string {
  switch (p.kind) {
    case "custom":
      return "crib-prov crib-prov--custom";
    case "radix":
      return "crib-prov crib-prov--radix";
    case "cva":
      return "crib-prov crib-prov--cva";
    case "lib":
      return "crib-prov crib-prov--lib";
  }
}

export type StockTone = "green" | "amber" | "red";

export function stockTone(consumerCount: number): StockTone {
  if (consumerCount >= 2) return "green";
  if (consumerCount === 1) return "amber";
  return "red";
}

export function stockLabel(consumerCount: number): string {
  const tone = stockTone(consumerCount);
  if (tone === "green") return `IN STOCK · ${consumerCount} CONSUMERS`;
  if (tone === "amber") return `FRAGILE · ${consumerCount} CONSUMER`;
  return "DEAD STOCK · 0 IMPORTS";
}
