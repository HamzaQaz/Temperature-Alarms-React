import { useEffect } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

// Reading storage throws when the browser blocks it (cookies off, some private modes);
// the default theme is then the answer rather than a page that never renders.
function storedTheme(storageKey: string): Theme | null {
  try {
    return localStorage.getItem(storageKey) as Theme | null
  } catch {
    return null
  }
}

// Applies the stored (or default) theme class to <html>. Nothing in the app
// switches themes at runtime, so there is no context or setter to expose.
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
  const theme = storedTheme(storageKey) || defaultTheme

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  return children
}
