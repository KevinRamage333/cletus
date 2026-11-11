/** @type {import('tailwindcss').Config} */
// The saved Cletus frontend used Tailwind "emerald" as its accent; here it's remapped to the gold palette (#D4AF37 → #F59E0B).
const gold = { 50: '#FDF8E7', 100: '#FAEFC6', 200: '#F5E08F', 300: '#EFCF63', 400: '#E6C04A', 500: '#D4AF37', 600: '#B8922A', 700: '#8F7020', 800: '#664F17', 900: '#3D2F0E', 950: '#1F1807' };
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false }, // a scoped preflight lives in globals.css (.tw) so the older pages keep their styles
  theme: { extend: { colors: { emerald: gold, gold, amber: { 400: '#FBBF24', 500: '#F59E0B', 600: '#D97706' } } } },
  plugins: [],
};
