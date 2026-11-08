import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import SignIn from './auth/SignIn'
import { supabaseConfigured } from './lib/supabase'
import NurseryHome from './nursery/NurseryHome'
import NurserySetup from './nursery/NurserySetup'
import { useNursery } from './nursery/useNursery'

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

  return <Signed userId={session.user.id} email={session.user.email} signOut={signOut} />
}

function Signed({
  userId,
  email,
  signOut,
}: {
  userId: string
  email: string | undefined
  signOut: () => Promise<void>
}) {
  const { nursery, members, loading, error, refresh, create, join, updateSurname } =
    useNursery(userId)

  if (loading) return <main className="flex h-full items-center justify-center">Loading…</main>
  if (error) {
    return (
      <main className="flex h-full items-center justify-center p-6 text-center text-red-700">
        {error}
      </main>
    )
  }
  if (!nursery) return <NurserySetup create={create} join={join} />
  return (
    <NurseryHome
      nursery={nursery}
      members={members}
      userId={userId}
      email={email}
      onRefresh={refresh}
      onUpdateSurname={updateSurname}
      onSignOut={signOut}
    />
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Home />
    </AuthProvider>
  )
}
