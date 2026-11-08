import { supabaseConfigured } from './lib/supabase'

export default function App() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-semibold">Swiper</h1>
      <p className="text-neutral-600">Swipe on baby names together.</p>
      {!supabaseConfigured && (
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env.local</code>.
        </p>
      )}
    </main>
  )
}
