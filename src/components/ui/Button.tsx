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
          "dark:bg-purple-600 light:bg-white text-white light:text-blue-600 dark:hover:bg-purple-700 light:hover:bg-white/90 h-11 px-8 font-semibold",
        variant === "outline" &&
          "border-2 dark:border-zinc-700 light:border-white/40 bg-transparent dark:text-white light:text-white dark:hover:bg-zinc-800 light:hover:bg-blue-400/20 dark:hover:border-zinc-600 light:hover:border-white/60 h-11 px-8",
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
