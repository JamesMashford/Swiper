import { Reorder, useDragControls } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ShortlistRow } from '../lib/types'
import { describeError, enqueue } from './errors'
import { fullName } from './names'
import { EmptyState, GenderChip, focusRing } from './ui'

type Status = 'idle' | 'saving' | 'saved' | 'error'

function initialOrder(rows: ShortlistRow[]) {
  return [...rows]
    .sort((a, b) => {
      if (a.my_position == null && b.my_position == null) return a.name.localeCompare(b.name)
      if (a.my_position == null) return 1
      if (b.my_position == null) return -1
      return a.my_position - b.my_position
    })
    .map((r) => r.name_id)
}

function RankItem({
  id,
  index,
  total,
  row,
  surname,
  onMove,
}: {
  id: number
  index: number
  total: number
  row: ShortlistRow
  surname: string
  onMove: (from: number, to: number) => void
}) {
  const controls = useDragControls()
  const btn = `flex size-11 items-center justify-center rounded-lg border border-neutral-300 text-neutral-800 disabled:opacity-30 ${focusRing}`
  const label = fullName(row.name, surname)
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm"
      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
    >
      <button
        type="button"
        aria-label={`Drag ${label} to reorder`}
        onPointerDown={(e) => controls.start(e)}
        className={`flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-neutral-500 ${focusRing}`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="4" r="1.6" /><circle cx="12" cy="4" r="1.6" />
          <circle cx="6" cy="9" r="1.6" /><circle cx="12" cy="9" r="1.6" />
          <circle cx="6" cy="14" r="1.6" /><circle cx="12" cy="14" r="1.6" />
        </svg>
      </button>
      <span className="w-6 shrink-0 text-center text-sm font-semibold text-rose-600">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-neutral-900">{label}</p>
        <div className="flex items-center gap-2">
          <GenderChip gender={row.gender} />
        </div>
      </div>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        className={btn}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === total - 1}
        onClick={() => onMove(index, index + 1)}
        className={btn}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </Reorder.Item>
  )
}

export default function RankTab({ rows, surname }: { rows: ShortlistRow[]; surname: string }) {
  const [order, setOrder] = useState<number[]>(() => initialOrder(rows))
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const latest = useRef(order)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)

  const save = useCallback(() => {
    window.clearTimeout(timer.current)
    dirty.current = false
    const ids = latest.current
    setStatus('saving')
    return enqueue(async () => {
      const res = await supabase.rpc('save_ranking', { p_name_ids: ids })
      const err = describeError(res)
      if (err) {
        setMessage(err)
        setStatus('error')
      } else if (!dirty.current) {
        setStatus('saved')
      }
    })
  }, [])

  const change = useCallback(
    (next: number[]) => {
      latest.current = next
      setOrder(next)
      dirty.current = true
      setStatus('saving')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(save, 600)
    },
    [save],
  )

  // Flush a pending save when leaving the tab.
  useEffect(
    () => () => {
      if (dirty.current) {
        window.clearTimeout(timer.current)
        const ids = latest.current
        void enqueue(async () => {
          await supabase.rpc('save_ranking', { p_name_ids: ids })
        })
      }
    },
    [],
  )

  const move = (from: number, to: number) => {
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    change(next)
  }

  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing to rank yet">
        No matches yet. Keep swiping, a name appears here when you both like it.
      </EmptyState>
    )
  }

  const byId = new Map(rows.map((r) => [r.name_id, r]))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">Drag or use the arrows. Your favourite goes on top.</p>
        <div aria-live="polite" className="shrink-0 text-sm">
          {status === 'saving' && <span className="text-neutral-500">Saving…</span>}
          {status === 'saved' && <span className="font-medium text-emerald-700">Saved</span>}
          {status === 'error' && (
            <span className="flex items-center gap-2 text-red-700">
              {message}
              <button
                type="button"
                onClick={save}
                className={`min-h-11 rounded-lg px-3 font-medium underline ${focusRing}`}
              >
                Retry
              </button>
            </span>
          )}
        </div>
      </div>
      <Reorder.Group axis="y" values={order} onReorder={change} className="flex flex-col gap-2">
        {order.map((id, i) => {
          const row = byId.get(id)
          return row ? (
            <RankItem key={id} id={id} index={i} total={order.length} row={row} surname={surname} onMove={move} />
          ) : null
        })}
      </Reorder.Group>
    </div>
  )
}
