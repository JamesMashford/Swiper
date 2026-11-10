import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

type Props = {
  /** Names of every new match; one shows the name, several show a count and a list. */
  names: string[]
  surname: string
  onSee: () => void
  onKeep: () => void
}

const COLORS = ['#4f46e5', '#818cf8', '#f43f5e', '#fbbf24', '#34d399']

// Fixed pseudo-random burst so rendering stays pure.
const PIECES = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.2
  const dist = 110 + ((i * 37) % 90)
  return {
    dx: Math.cos(angle) * dist,
    dy: Math.sin(angle) * dist - 30,
    rot: (i * 53) % 360,
    color: COLORS[i % COLORS.length],
    size: 6 + (i % 3) * 3,
  }
})

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function MatchOverlay({ names, surname, onSee, onKeep }: Props) {
  const reduce = useReducedMotion()
  const dialog = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  // Read while rendering, before the page behind goes inert and drops focus.
  const [opener] = useState<Element | null>(() => document.activeElement)
  const last = surname.trim()
  const full = (n: string) => `${n} ${last}`.trim()
  const many = names.length > 1

  useEffect(() => {
    primary.current?.focus()
    return () => {
      // Give focus back to where it was; if that screen is gone, to the page itself.
      const back =
        opener instanceof HTMLElement && opener !== document.body && opener.isConnected ? opener : null
      ;(back ?? document.getElementById('main'))?.focus()
    }
  }, [opener])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKeep])

  // Keep Tab and Shift+Tab inside the dialog.
  function trap(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab') return
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const end = items[items.length - 1]
    const active = document.activeElement
    if (!dialog.current?.contains(active)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && active === first) {
      e.preventDefault()
      end.focus()
    } else if (!e.shiftKey && active === end) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <motion.div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      onKeyDown={trap}
      aria-labelledby="match-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/70 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.2 }}
    >
      <motion.div
        className="relative w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl"
        initial={reduce ? false : { scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        {!reduce && (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-24">
            {PIECES.map((p, i) => (
              <motion.span
                key={i}
                className="absolute rounded-sm"
                style={{ width: p.size, height: p.size * 1.6, background: p.color }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                animate={{ x: p.dx, y: p.dy + 60, opacity: 0, rotate: p.rot }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            ))}
          </div>
        )}
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-700">
          {many ? 'New matches' : "It's a match"}
        </p>
        <h2 id="match-title" className="mt-3 break-words text-4xl font-bold leading-tight text-neutral-900">
          {many ? `${names.length} new matches` : full(names[0])}
        </h2>
        {many && (
          <ul className="mt-3 max-h-40 overflow-y-auto text-lg font-medium text-neutral-800">
            {names.map((n, i) => (
              <li key={i} className="break-words">
                {full(n)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-neutral-700">
          {many ? 'You both liked these names.' : 'You both liked this name.'}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            ref={primary}
            type="button"
            onClick={onSee}
            className="min-h-12 rounded-full bg-indigo-600 px-6 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            See matches
          </button>
          <button
            type="button"
            onClick={onKeep}
            className="min-h-12 rounded-full px-6 font-semibold text-neutral-800 ring-1 ring-neutral-400 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Keep swiping
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
