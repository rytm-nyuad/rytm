"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start with the SSR-safe default so the server-rendered HTML and the
  // client's first hydration pass match exactly (the server can never see
  // localStorage, so branching on it here caused a hydration mismatch — e.g.
  // Sun vs Moon icon in TopNav — for any user whose saved theme was "light").
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  // Client-only: pick up the saved preference right after mount. This runs
  // after the first (server-matching) render, so the resulting update is a
  // normal client re-render, not part of hydration — safe for it to differ
  // from the server's "dark" default.
  useEffect(() => {
    const savedTheme = localStorage.getItem("rytm-theme") as Theme | null;
    if (savedTheme) setTheme(savedTheme);
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Don't persist the transient SSR default before we've read the real saved value.
    if (!hydrated) return;
    localStorage.setItem("rytm-theme", theme);
  }, [theme, hydrated]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className={theme}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
