import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";
const variants: Record<Variant, string> = {
  primary: "bg-steel text-white hover:bg-steel-dark disabled:bg-ink-faint",
  secondary: "border border-line bg-panel text-ink hover:border-steel hover:text-steel disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-steel-wash hover:text-steel",
  danger: "border border-signal-red/40 bg-panel text-signal-red hover:bg-signal-red hover:text-white",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-[15px]" };

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; pending?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", pending, disabled, children, ...props }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn("inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed", variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
});

export function LinkButton({ className, variant = "secondary", size = "md", ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a className={cn("inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors", variants[variant], sizes[size], className)} {...props} />;
}
