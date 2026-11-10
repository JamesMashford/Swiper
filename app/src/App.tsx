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
import { primaryClass } from './ui/styles'

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
  const { nursery, members, loading, loaded, error, refresh, retry, dismissError, create, join } =
    useNursery(userId)

  if (loading) return <main className="flex h-full items-center justify-center">Loading…</main>
  // Only a failure of the very first load replaces the app.
  if (error && !loaded) {
    return (
      <main className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Swiper</h1>
        <p role="alert" className="text-red-800">
          {error}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={() => void retry()} className={`${primaryClass} bg-rose-600`}>
            Retry
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="min-h-11 rounded-lg border border-neutral-400 px-4 py-2 text-base font-medium text-neutral-900"
          >
            Sign out
          </button>
        </div>
      </main>
    )
  }
  if (!nursery) {
    return (
      <>
        {error && <ErrorBanner message={error} onRetry={refresh} onDismiss={dismissError} />}
        <NurserySetup create={create} join={join} />
      </>
    )
  }
  return (
    <Shell
      nursery={nursery}
      members={members}
      userId={userId}
      email={email}
      refreshNursery={refresh}
      signOut={signOut}
      banner={error ? { message: error, onRetry: refresh, onDismiss: dismissError } : null}
    />
  )
}

function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string
  onRetry: () => Promise<void>
  onDismiss: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div
      role="alert"
      data-testid="error-banner"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 py-1 pl-4 pr-1 text-sm text-amber-950"
    >
      <span className="flex-1 py-2">{message}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await onRetry()
          setBusy(false)
        }}
        className="min-h-11 rounded-lg px-3 font-semibold underline disabled:opacity-60"
      >
        {busy ? 'Retrying…' : 'Retry'}
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-11 items-center justify-center text-xl"
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  )
}

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '')
  return TABS.some((t) => t.id === h) ? (h as TabId) : 'swipe'
}

type Banner = { message: string; onRetry: () => Promise<void>; onDismiss: () => void }

function Shell({ banner, ...props }: ScreenProps & { banner: Banner | null }) {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const { alerts, unseen, dismiss, markSeen } = useMatchAlerts(props.nursery.id)

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

  const open = alerts.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* The page behind a modal dialog is inert: no focus, clicks or screen reader access. */}
      <main id="main" tabIndex={-1} inert={open} className="flex min-h-0 flex-1 flex-col outline-none">
        {banner && <ErrorBanner {...banner} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'swipe' && <SwipeScreen {...props} onNavigate={change} />}
          {tab === 'matches' && <MatchesScreen {...props} />}
          {tab === 'shortlist' && <ShortlistScreen {...props} />}
          {tab === 'settings' && <SettingsScreen {...props} />}
        </div>
      </main>
      <TabBar
        active={tab}
        onChange={change}
        inert={open}
        badge={{ matches: unseen && tab !== 'matches' }}
      />
      {open && (
        <MatchOverlay
          names={alerts.map((a) => a.name)}
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
