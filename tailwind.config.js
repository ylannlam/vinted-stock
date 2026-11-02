/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        teal: {50:'#edf7f1',100:'#d5ecdf',200:'#acdac3',300:'#78c4a0',400:'#42ab7d',500:'#209564',600:'#10865d',700:'#087f5b',800:'#08664c',900:'#124e3c',950:'#063025'},
      },
    },
  },
  plugins: [],
}
