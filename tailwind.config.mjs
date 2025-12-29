/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        cream: '#f5f1eb',
        charcoal: '#1f1b1a',
        coral: {
          50: '#fef5f3',
          100: '#fde8e3',
          200: '#fcd5cc',
          300: '#f8b6a6',
          400: '#e58b73',
          500: '#d9714f',
          600: '#c55a3a',
          700: '#a5472c',
          800: '#893d28',
          900: '#723627',
        },
        olive: {
          50: '#f4f7f4',
          100: '#e5ebe6',
          200: '#ccd8ce',
          300: '#a6bda9',
          400: '#789c7e',
          500: '#3d5f46',
          600: '#385643',
          700: '#2e4637',
          800: '#27392e',
          900: '#212f27',
        },
        neutral: {
          50: '#faf9f7',
          100: '#f5f3f0',
          200: '#e8e4de',
          300: '#d6d0c7',
          400: '#b8b0a3',
          500: '#9a9083',
          600: '#7d7368',
          700: '#665d54',
          800: '#534b44',
          900: '#433d38',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      fontSize: {
        'display': ['clamp(2.5rem, 5vw, 4rem)', { lineHeight: '1.1', fontWeight: '700' }],
        'headline': ['clamp(1.75rem, 3vw, 2.5rem)', { lineHeight: '1.2', fontWeight: '600' }],
        'body-lg': ['clamp(1.125rem, 1.5vw, 1.25rem)', { lineHeight: '1.6' }],
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#1f1b1a',
            lineHeight: '1.75',
            maxWidth: 'none',
            h1: {
              color: '#1f1b1a',
              fontFamily: 'Fraunces, Georgia, serif',
              marginTop: '0',
              marginBottom: '1.5rem',
            },
            h2: {
              color: '#1f1b1a',
              fontFamily: 'Fraunces, Georgia, serif',
              marginTop: '2.5rem',
              marginBottom: '1rem',
            },
            h3: {
              color: '#1f1b1a',
              fontFamily: 'Fraunces, Georgia, serif',
              marginTop: '2rem',
              marginBottom: '0.75rem',
            },
            p: {
              marginTop: '1.25rem',
              marginBottom: '1.25rem',
            },
            ul: {
              marginTop: '1.25rem',
              marginBottom: '1.25rem',
            },
            li: {
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
            },
            a: {
              color: '#3d5f46',
              textDecoration: 'underline',
              '&:hover': {
                color: '#2e4637',
              },
            },
            strong: {
              color: '#1f1b1a',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
