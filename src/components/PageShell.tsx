import { Navbar } from "./FloatingNavbar";
import { cn } from "@/lib/utils";

type NavbarVariant = "floating" | "sticky";

interface PageShellProps {
  children: React.ReactNode;
  navbarVariant?: NavbarVariant;
  contentOffsetClass?: string;
}

/**
 * PageShell wrapper with configurable navbar variant and content offset.
 * - Floating navbar: used on landing page (modern floating pill)
 * - Sticky navbar: used on content pages (integrated into layout)
 * Use contentOffsetClass to control per-page top padding when using floating variant.
 */
export function PageShell({ 
  children, 
  navbarVariant = "floating",
  contentOffsetClass 
}: PageShellProps) {
  // Sticky navbar doesn't need offset since it's part of the layout
  const defaultOffset = navbarVariant === "sticky" ? "" : "pt-24";
  const offset = contentOffsetClass ?? defaultOffset;

  return (
    <>
      <Navbar variant={navbarVariant} />
      <main className={cn("min-h-screen bg-white text-black", offset)}>
        {children}
      </main>
    </>
  );
}
