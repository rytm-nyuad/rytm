import * as React from "react"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline"
  }
>(({ className, variant = "default", children, ...props }, ref) => {
  return (
    <button
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 dark:focus-visible:ring-purple-600 light:focus-visible:ring-white/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variant === "default" &&
          "bg-purple-600 text-white hover:bg-purple-700 h-11 px-8 font-semibold dark:bg-purple-600 dark:hover:bg-purple-700",
        variant === "outline" &&
          // Always visible: strong border, subtle bg, shadow, dark text in light mode
          "border border-zinc-400 bg-zinc-50 text-zinc-900 shadow-sm hover:bg-zinc-100 hover:border-zinc-600 "+
          "dark:border-zinc-700 dark:bg-transparent dark:text-white dark:hover:bg-zinc-800 dark:hover:border-zinc-600 "+
          "light:border-zinc-400 light:bg-zinc-50 light:text-zinc-900 light:hover:bg-zinc-100 light:hover:border-zinc-600 h-11 px-8",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  )
})
Button.displayName = "Button"

export { Button }
