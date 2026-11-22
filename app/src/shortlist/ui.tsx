import type { ReactNode } from 'react'
import type { Gender } from '../lib/types'

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600'

const chipStyle: Record<Gender, string> = {
  boy: 'bg-sky-50 text-sky-800',
  girl: 'bg-rose-50 text-rose-800',
  neutral: 'bg-neutral-100 text-neutral-700',
}

export function GenderChip({ gender }: { gender: Gender }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${chipStyle[gender]}`}>
      {gender}
    </span>
  )
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-neutral-100 motion-reduce:animate-none" />
      ))}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`min-h-11 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white ${focusRing}`}
      >
        Retry
      </button>
    </div>
  )
}

export function EmptyState({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center">
      {title && <p className="mb-1 font-semibold text-neutral-900">{title}</p>}
      <p className="text-sm text-neutral-600">{children}</p>
    </div>
  )
}
