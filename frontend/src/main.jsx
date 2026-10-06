import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// tipo de letra do logótipo servido pela própria aplicação (sem pedidos a terceiros — RGPD)
import '@fontsource/poppins/latin-600.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
