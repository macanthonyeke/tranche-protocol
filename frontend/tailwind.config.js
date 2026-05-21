/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Tranche tokens */
        paper:        'var(--paper)',
        sunk:         'var(--sunk)',
        ink:          'var(--ink)',
        'ink-2':      'var(--ink-2)',
        'ink-3':      'var(--ink-3)',
        rule:         'var(--rule)',
        'rule-2':     'var(--rule-2)',
        clay:         'var(--clay)',
        'clay-hover': 'var(--clay-hover)',
        'clay-soft':  'var(--clay-soft)',
        ok:           'var(--ok)',
        warn:         'var(--warn)',
        bad:          'var(--bad)'
      },
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        geist:   ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      letterSpacing: {
        tightest: '-0.045em'
      },
      maxWidth: {
        prose:   '68ch',
        content: '1200px',
        page:    '1320px'
      },
      borderRadius: {
        /* Tranche radii — flatter, crisper than the old 0.75/1rem feel.
           We deliberately downgrade xl/2xl so existing components shed
           pillowy edges without code changes. */
        xs: '0.25rem',
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.5rem',
        xl: '0.5rem',
        '2xl': '0.5rem'
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
