import { Toaster as Sonner, toast } from "sonner";
import type { ComponentProps } from "react";
export { toast };
export function Toaster(props: ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "!border-line !bg-surface !text-fg",
          description: "!text-fg-muted",
          actionButton: "!bg-accent !text-bg",
          cancelButton: "!bg-surface-strong !text-fg",
        },
      }}
      {...props}
    />
  );
}
