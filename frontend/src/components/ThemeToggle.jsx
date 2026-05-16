import { useTheme } from '../hooks/useTheme.jsx'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-border-subtle text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M12 9.5a4.5 4.5 0 0 1-5.5-5.5A5 5 0 1 0 12 9.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      )}
    </button>
  )
}
