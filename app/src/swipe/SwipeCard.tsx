import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'framer-motion'
import { useImperativeHandle, type Ref } from 'react'
import type { NameCard } from '../lib/types'

export type CardHandle = { fly: (liked: boolean) => void }

type Props = {
  card: NameCard
  surname: string
  isTop: boolean
  onCommit: (card: NameCard, liked: boolean) => void
  ref?: Ref<CardHandle>
}

const DISTANCE = 100
const VELOCITY = 500

export default function SwipeCard({ card, surname, isTop, onCommit, ref }: Props) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 0, 220], reduce ? [0, 0, 0] : [-14, 0, 14])
  const likeOpacity = useTransform(x, [20, DISTANCE], [0, 1])
  const nopeOpacity = useTransform(x, [-DISTANCE, -20], [1, 0])
  const last = surname.trim()

  function fly(liked: boolean) {
    if (reduce) {
      onCommit(card, liked)
      return
    }
    animate(x, liked ? 520 : -520, { duration: 0.22, ease: 'easeIn' }).then(() =>
      onCommit(card, liked),
    )
  }

  useImperativeHandle(ref, () => ({ fly }))

  function onDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info
    if (offset.x > DISTANCE || (velocity.x > VELOCITY && offset.x > 20)) fly(true)
    else if (offset.x < -DISTANCE || (velocity.x < -VELOCITY && offset.x < -20)) fly(false)
    else animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
  }

  return (
    <motion.article
      data-testid={isTop ? 'top-card' : 'back-card'}
      aria-hidden={isTop ? undefined : true}
      aria-label={isTop ? `${card.name} ${last}`.trim() : undefined}
      initial={false}
      animate={{ scale: isTop ? 1 : 0.94, y: isTop ? 0 : 30 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 28 }}
      drag={isTop && !reduce ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      onDragEnd={isTop ? onDragEnd : undefined}
      style={{ x: isTop ? x : 0, rotate: isTop ? rotate : 0, zIndex: isTop ? 2 : 1 }}
      className="absolute inset-0 flex cursor-grab select-none flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)] ring-1 ring-neutral-200 active:cursor-grabbing"
    >
      {isTop && (
        <>
          <motion.span
            aria-hidden
            style={{ opacity: likeOpacity }}
            className="pointer-events-none absolute left-5 top-5 -rotate-12 rounded-lg border-4 border-indigo-600 px-3 py-1 text-2xl font-extrabold tracking-widest text-indigo-600"
          >
            LIKE
          </motion.span>
          <motion.span
            aria-hidden
            style={{ opacity: nopeOpacity }}
            className="pointer-events-none absolute right-5 top-5 rotate-12 rounded-lg border-4 border-rose-500 px-3 py-1 text-2xl font-extrabold tracking-widest text-rose-500"
          >
            NOPE
          </motion.span>
        </>
      )}

      <div className="mt-14 flex flex-col gap-3">
        <span className="w-fit rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {card.gender}
        </span>
        <h2 className="break-words text-5xl font-bold leading-[1.05] tracking-tight text-neutral-900">
          {card.name}
          {last && <span className="block text-3xl font-medium text-neutral-400">{last}</span>}
        </h2>
        {card.origins.length > 0 && (
          <p className="text-sm font-medium text-indigo-700">{card.origins.join(' · ')}</p>
        )}
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {card.meaning && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Meaning</p>
            <p className="text-lg leading-snug text-neutral-800">{card.meaning}</p>
          </div>
        )}
        {card.blurb && <p className="text-base italic leading-snug text-neutral-500">{card.blurb}</p>}
      </div>

      {card.style_tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {card.style_tags.slice(0, 4).map((t) => (
            <li key={t} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              {t}
            </li>
          ))}
        </ul>
      )}
    </motion.article>
  )
}
