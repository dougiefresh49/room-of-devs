import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export const ToggleGroup = ToggleGroupPrimitive.Root;
export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) { return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cn("inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent data-[state=on]:bg-surface-strong data-[state=on]:text-fg", className)} {...props} />; }
