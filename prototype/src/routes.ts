export type Route = "console" | "field" | "crib" | "map";

export { CribView } from "./crib/CribView";
export { MapView } from "./map/MapView";

export function currentRoute(): Route {
  if (typeof window === "undefined") return "console";
  const path = window.location.pathname;
  if (path.startsWith("/field")) return "field";
  if (path.startsWith("/crib")) return "crib";
  if (path.startsWith("/map")) return "map";
  return "console";
}
