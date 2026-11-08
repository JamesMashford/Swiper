import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import SignIn from './auth/SignIn'
import { supabaseConfigured } from './lib/supabase'

function Home() {
  const { session, loading, signOut } = useAuth()

  if (!supabaseConfigured) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-3xl font-semibold">Swiper</h1>
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env.local</code>.
        </p>
      </main>
    )
  }
  if (loading) return <main className="flex h-full items-center justify-center">Loading…</main>
  if (!session) return <SignIn />

  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-semibold">Swiper</h1>
      <p className="text-neutral-600">Signed in as {session.user.email}</p>
      <button className="text-sm underline" onClick={signOut}>
        Sign out
      </button>
    </main>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Home />
    </AuthProvider>
  )
}
