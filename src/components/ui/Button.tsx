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
        "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variant === "default" &&
          "bg-purple-600 text-white hover:bg-purple-700 h-11 px-8",
        variant === "outline" &&
          "border-2 border-zinc-700 bg-transparent text-white hover:bg-zinc-800 hover:border-zinc-600 h-11 px-8",
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
