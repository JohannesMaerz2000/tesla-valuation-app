/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                tesla: {
                    red: '#E82127',
                    dark: '#18181B',
                    gray: '#393c41',
                    light: '#f4f4f4'
                }
            }
        },
    },
    plugins: [],
}
