import type { ShortlistRow } from '../lib/types'
import { fullName } from './names'
import { EmptyState, GenderChip } from './ui'

const medal = [
  { label: 'Gold', cls: 'bg-amber-100 text-amber-800 ring-amber-300', icon: '1' },
  { label: 'Silver', cls: 'bg-neutral-200 text-neutral-700 ring-neutral-400', icon: '2' },
  { label: 'Bronze', cls: 'bg-orange-100 text-orange-800 ring-orange-300', icon: '3' },
]

export default function CoupleTab({ rows, surname }: { rows: ShortlistRow[]; surname: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No matches yet">
        No matches yet. Keep swiping, a name appears here when you both like it.
      </EmptyState>
    )
  }
  const sorted = [...rows].sort((a, b) => a.combined_rank - b.combined_rank)
  const unranked = rows.every((r) => r.my_position == null && r.my_elo === 1000)

  return (
    <div className="flex flex-col gap-3">
      {unranked && (
        <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-900">
          You have not ranked yet. This ranking gets better once you both rank or duel.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {sorted.map((r, i) => {
          const m = i < 3 ? medal[i] : null
          return (
            <li
              key={r.name_id}
              className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm ${
                m ? 'border-neutral-300 bg-white' : 'border-neutral-200 bg-white'
              }`}
            >
              <span
                aria-label={m ? `${m.label}, rank ${i + 1}` : `Rank ${i + 1}`}
                className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  m ? `${m.cls} ring-2` : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-semibold text-neutral-900 ${m ? 'text-lg' : ''}`}>
                    {fullName(r.name, surname)}
                  </p>
                  <GenderChip gender={r.gender} />
                </div>
                {r.meaning && <p className="text-sm text-neutral-600">{r.meaning}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
