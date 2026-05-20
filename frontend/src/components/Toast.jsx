import { Toaster as SonnerToaster } from 'sonner'
import { useTheme } from '../hooks/useTheme.jsx'

/* Sonner Toaster, themed against our CSS variables. */
export default function ToastViewport() {
  const { theme } = useTheme()
  return (
    <SonnerToaster
      theme={theme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      richColors
      closeButton
      expand={false}
      visibleToasts={3}
      duration={4000}
      toastOptions={{
        style: {
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
          borderRadius: '0.75rem'
        }
      }}
    />
  )
}
