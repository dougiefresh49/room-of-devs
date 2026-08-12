export type FieldScreen = "glance" | "coms" | "orders" | "gauges";

export interface FieldBadge {
  tone: "red" | "amber";
  pulse?: boolean;
  label: string;
}
