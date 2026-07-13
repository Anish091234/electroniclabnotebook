import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "firebase", test: /node_modules[\\/]firebase/ },
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router-dom)/ },
          ],
        },
      },
    },
  },
})
