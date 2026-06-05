import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serve i project site da /<nome-repo>/.
// `base` DEVE coincidere col nome esatto del repository, altrimenti in
// produzione gli asset non vengono trovati e la pagina resta bianca.
// Il componente legge graph.json via import.meta.env.BASE_URL, quindi
// questo valore vale sia in dev sia in build.
export default defineConfig({
  plugins: [react()],
  base: '/new-release-atlas/',
})
