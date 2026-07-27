import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn.js";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("fixed inset-0 z-50 bg-bg/80", className)}
      {...props}
    />
  );
}

/**
 * `full` is an edge-to-edge surface (no border, no anchor edge) for screens
 * that take over the whole viewport — a mobile conversation, say. It still
 * gets the Radix focus trap, Escape handling and focus return, which is the
 * entire reason to reach for it over a hand-rolled fixed div.
 */
type SheetSide = "top" | "right" | "bottom" | "left" | "full";
const sideClasses: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 border-b",
  right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
  bottom: "inset-x-0 bottom-0 border-t",
  left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
  full: "inset-0",
};

interface SheetContentOptions {
  side?: SheetSide;
  /**
   * The built-in corner close button. Turn it off when the sheet already
   * renders its own dismiss affordance (a grab handle, a header ✕) — two
   * close buttons is worse for screen readers than one.
   */
  showClose?: boolean;
  /** Style the scrim (opacity/color/z-index) without restyling the sheet. */
  overlayClassName?: string;
}

export function SheetContent({
  className,
  children,
  side = "right",
  showClose = true,
  overlayClassName,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & SheetContentOptions) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 grid gap-4 bg-surface p-6 text-fg shadow-xl outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}
export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}
export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-fg-muted", className)}
      {...props}
    />
  );
}
