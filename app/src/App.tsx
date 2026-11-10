import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import SignIn from './auth/SignIn'
import { supabaseConfigured } from './lib/supabase'
import NurserySetup from './nursery/NurserySetup'
import { useNursery } from './nursery/useNursery'
import MatchesScreen from './screens/MatchesScreen'
import SettingsScreen from './screens/SettingsScreen'
import ShortlistScreen from './screens/ShortlistScreen'
import SwipeScreen from './screens/SwipeScreen'
import TabBar from './ui/TabBar'
import { TABS, type ScreenProps, type TabId } from './lib/types'
import { useEffect, useState } from 'react'
import { useMatchAlerts } from './realtime/useMatchAlerts'
import MatchOverlay from './ui/MatchOverlay'

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
  const { nursery, members, loading, error, refresh, create, join } = useNursery(userId)

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
    <Shell
      nursery={nursery}
      members={members}
      userId={userId}
      email={email}
      refreshNursery={refresh}
      signOut={signOut}
    />
  )
}

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '')
  return TABS.some((t) => t.id === h) ? (h as TabId) : 'swipe'
}

function Shell(props: ScreenProps) {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const { current, unseen, dismiss, markSeen } = useMatchAlerts(props.nursery.id)

  const change = (next: TabId) => {
    if (next === 'matches' || tab === 'matches') markSeen()
    window.location.hash = next
    setTab(next)
  }

  // Lets screens navigate by setting the hash and firing hashchange.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'swipe' && <SwipeScreen {...props} onNavigate={change} />}
        {tab === 'matches' && <MatchesScreen {...props} />}
        {tab === 'shortlist' && <ShortlistScreen {...props} />}
        {tab === 'settings' && <SettingsScreen {...props} />}
      </div>
      <TabBar active={tab} onChange={change} badge={{ matches: unseen && tab !== 'matches' }} />
      {current && (
        <MatchOverlay
          key={current.nameId}
          name={current.name}
          surname={props.nursery.surname}
          onSee={() => {
            dismiss()
            change('matches')
          }}
          onKeep={dismiss}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Home />
    </AuthProvider>
  )
}
