import { TABS, type TabId } from '../lib/types'

type Props = {
  active: TabId
  onChange: (tab: TabId) => void
  badge?: Partial<Record<TabId, boolean>>
  inert?: boolean
}

export default function TabBar({ active, onChange, badge = {}, inert }: Props) {
  return (
    <nav
      aria-label="Main"
      inert={inert}
      className="flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={active === t.id ? 'page' : undefined}
          onClick={() => onChange(t.id)}
          className={`relative min-h-12 flex-1 px-2 py-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-neutral-900 ${
            active === t.id ? 'font-semibold text-neutral-900' : 'text-neutral-500'
          }`}
        >
          {t.label}
          {badge[t.id] && (
            <>
              <span aria-hidden className="absolute right-1/4 top-2 size-2 rounded-full bg-rose-500" />
              <span className="sr-only"> (new match)</span>
            </>
          )}
        </button>
      ))}
    </nav>
  )
}
