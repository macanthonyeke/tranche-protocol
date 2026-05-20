/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)'
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)'
        },
        border: {
          subtle: 'var(--border-subtle)',
          medium: 'var(--border-medium)',
          focused: 'var(--border-focused)'
        },
        accent: {
          DEFAULT: 'var(--accent-blue)',
          blue: 'var(--accent-blue)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)'
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          error: 'var(--status-error)'
        }
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        geist: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem'
      },
      maxWidth: {
        content: '1200px'
      },
      boxShadow: {
        'lift-sm':     'var(--shadow-lift-sm)',
        'lift-md':     'var(--shadow-lift-md)',
        'lift-lg':     'var(--shadow-lift-lg)',
        'glow-accent': 'var(--shadow-glow-accent)'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')({ strategy: 'class' })]
}
