import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function start() {
  if (import.meta.env.VITE_MOCK === '1') {
    const { installMockSupabase } = await import('./dev/mockSupabase')
    installMockSupabase(new URL(import.meta.env.VITE_SUPABASE_URL as string).origin)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start()
