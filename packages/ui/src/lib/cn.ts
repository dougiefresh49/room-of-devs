import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class combiner for vendored primitives (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
