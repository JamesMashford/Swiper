import { useCallback, useEffect, useRef } from 'react'
import type { NameCard, ScreenProps, TabId } from '../lib/types'
import SwipeCard, { type CardHandle } from '../swipe/SwipeCard'
import { useDeck } from '../swipe/useDeck'

type Props = ScreenProps & { onNavigate?: (tab: TabId) => void }

function goTo(tab: TabId, onNavigate?: (tab: TabId) => void) {
  if (onNavigate) onNavigate(tab)
  else {
    window.location.hash = tab
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

function CenterMessage({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-2xl font-semibold text-neutral-900">{title}</h2>
      {body && <p className="max-w-xs text-neutral-600">{body}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-11 rounded-full bg-indigo-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex h-full flex-col px-4 pt-4" aria-busy="true" aria-label="Loading names">
      <div className="min-h-0 flex-1 animate-pulse rounded-3xl bg-neutral-100 p-6">
        <div className="mt-14 h-6 w-16 rounded-full bg-neutral-200" />
        <div className="mt-4 h-14 w-3/4 rounded-xl bg-neutral-200" />
        <div className="mt-3 h-8 w-1/2 rounded-xl bg-neutral-200" />
        <div className="mt-10 h-5 w-full rounded bg-neutral-200" />
        <div className="mt-3 h-5 w-2/3 rounded bg-neutral-200" />
      </div>
      <div className="flex justify-center gap-10 py-5">
        <div className="size-16 rounded-full bg-neutral-100" />
        <div className="size-16 rounded-full bg-neutral-100" />
      </div>
    </div>
  )
}

export default function SwipeScreen({ nursery, userId, onNavigate }: Props) {
  const { queue, status, loadError, swipeError, dismissSwipeError, swipe, reload } = useDeck(userId)
  const topRef = useRef<CardHandle>(null)
  const flying = useRef(false)

  const top = queue[0]
  const topId = top?.id

  const commit = useCallback(
    (card: NameCard, liked: boolean) => {
      flying.current = false
      void swipe(card, liked)
    },
    [swipe],
  )

  const act = useCallback((liked: boolean) => {
    if (!topRef.current || flying.current) return
    flying.current = true
    topRef.current.fly(liked)
  }, [])

  // A different top card means the previous one has finished leaving.
  useEffect(() => {
    flying.current = false
  }, [topId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      act(e.key === 'ArrowRight')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act])

  if (status === 'loading') return <Skeleton />
  if (status === 'missing')
    return (
      <CenterMessage
        title="The database needs the latest update"
        body="The name suggestion function is not available yet. Apply the newest Supabase migration, then try again."
        action={{ label: 'Retry', onClick: reload }}
      />
    )
  if (status === 'error')
    return (
      <CenterMessage
        title="Could not load names"
        body={loadError ?? undefined}
        action={{ label: 'Retry', onClick: reload }}
      />
    )
  if (status === 'empty' || !top)
    return (
      <CenterMessage
        title="You have seen every name that fits your filters"
        body="Widen the gender or origin filters to see more names."
        action={{ label: 'Open Settings', onClick: () => goTo('settings', onNavigate) }}
      />
    )

  // Render the back card first so the top card paints above it.
  const visible = queue.slice(0, 2).reverse()

  const circle =
    'flex size-16 items-center justify-center rounded-full shadow-md transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'

  return (
    <section className="flex h-full flex-col overflow-hidden px-4 pt-4" aria-label="Swipe names">
      {swipeError && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-rose-50 py-3 pl-4 pr-1 text-sm text-rose-800 ring-1 ring-rose-200"
        >
          <span className="py-2">{swipeError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={dismissSwipeError}
            className="-my-1 flex size-11 shrink-0 items-center justify-center rounded-full text-xl hover:bg-rose-100"
          >
            ×
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {visible.map((card, i) => {
          const isTop = i === visible.length - 1
          return (
            <SwipeCard
              key={card.id}
              ref={isTop ? topRef : undefined}
              card={card}
              surname={nursery.surname}
              isTop={isTop}
              onCommit={commit}
            />
          )
        })}
      </div>
      <div className="flex items-center justify-center gap-10 py-5">
        <button
          type="button"
          aria-label="Dislike"
          onClick={() => act(false)}
          className={`${circle} bg-white text-rose-500 ring-1 ring-neutral-200 hover:bg-rose-50`}
        >
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Like"
          onClick={() => act(true)}
          className={`${circle} bg-indigo-600 text-white hover:bg-indigo-700`}
        >
          <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden>
            <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.8 5 6.2 5c2 0 3.2 1 3.8 2 .6-1 1.8-2 3.8-2 3.4 0 5.3 3.4 3.8 6.8C19.5 16.4 12 21 12 21z" />
          </svg>
        </button>
      </div>
    </section>
  )
}
