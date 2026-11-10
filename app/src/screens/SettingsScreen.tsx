import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { GENDERS, ORIGINS, type ScreenProps } from '../lib/types'

const card = 'rounded-xl border border-neutral-200 bg-white p-4'
const field =
  'min-h-11 w-full min-w-0 rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-900 focus-visible:outline-2 focus-visible:outline-rose-600'
const primary =
  'min-h-11 rounded-lg bg-rose-600 px-4 py-2 text-base font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-60'
const secondary =
  'min-h-11 rounded-lg border border-neutral-300 px-4 py-2 text-base font-medium text-neutral-900 focus-visible:outline-2 focus-visible:outline-rose-600 disabled:opacity-60'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-base capitalize focus-visible:outline-2 focus-visible:outline-rose-600 ${
        selected
          ? 'border-rose-600 bg-rose-600 text-white'
          : 'border-neutral-300 bg-white text-neutral-900'
      }`}
    >
      {label}
    </button>
  )
}

const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()
const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

export default function SettingsScreen({
  nursery,
  members,
  userId,
  email,
  refreshNursery,
  signOut,
}: ScreenProps) {
  const me = members.find((m) => m.user_id === userId)
  const partner = members.find((m) => m.user_id !== userId)

  const [surname, setSurname] = useState(nursery.surname)
  const [displayName, setDisplayName] = useState(me?.display_name ?? '')
  const [genders, setGenders] = useState<string[]>(nursery.genders)
  const [origins, setOrigins] = useState<string[]>(nursery.origins)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLParagraphElement>(null)

  function flash(key: string, text: string) {
    setNotice((n) => ({ ...n, [key]: text }))
    setTimeout(() => setNotice((n) => ({ ...n, [key]: '' })), 2500)
  }

  async function run(key: string, action: () => Promise<string | null>, ok?: string) {
    setBusy(key)
    setError(null)
    const msg = await action()
    setBusy(null)
    if (msg) setError(msg)
    else if (ok) flash(key, ok)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(nursery.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const el = codeRef.current
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      setError('Could not copy automatically. The code is selected: press and hold to copy it.')
    }
  }

  const saveSurname = (e: FormEvent) => {
    e.preventDefault()
    run(
      'surname',
      async () => {
        const { error: err } = await supabase
          .from('nurseries')
          .update({ surname: surname.trim() })
          .eq('id', nursery.id)
        if (err) return err.message
        await refreshNursery()
        return null
      },
      'Saved',
    )
  }

  const saveName = (e: FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    if (!name) return setError('Your name cannot be empty.')
    run(
      'name',
      async () => {
        const { error: err } = await supabase
          .from('profiles')
          .update({ display_name: name })
          .eq('id', userId)
        if (err) return err.message
        await refreshNursery()
        return null
      },
      'Saved',
    )
  }

  const toggleGender = (g: string) => {
    if (genders.includes(g) && genders.length === 1) {
      setError('Keep at least one gender selected.')
      return
    }
    setGenders(toggle(genders, g))
  }

  const filtersChanged = !sameSet(genders, nursery.genders) || !sameSet(origins, nursery.origins)

  const saveFilters = () =>
    run(
      'filters',
      async () => {
        const { error: err } = await supabase
          .from('nurseries')
          .update({ genders, origins })
          .eq('id', nursery.id)
        if (err) return err.message
        await refreshNursery()
        return null
      },
      'Saved. The new filters apply to both of you.',
    )

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 overflow-x-hidden p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg bg-red-50 py-2 pl-3 text-sm text-red-800"
        >
          <span className="py-2">{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            className="-my-2 min-h-11 min-w-11 text-lg"
          >
            ×
          </button>
        </div>
      )}

      <Section title="Nursery">
        <div className="text-center">
          <p className="text-sm text-neutral-600">Invite code</p>
          <p
            ref={codeRef}
            data-testid="invite-code"
            className="my-1 select-all break-all text-3xl font-semibold tracking-widest"
          >
            {nursery.invite_code}
          </p>
          <button type="button" className={secondary} onClick={copyCode}>
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>

        {partner ? (
          <p className="text-center text-neutral-800">Linked with {partner.display_name}</p>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-neutral-800">Waiting for your partner</p>
            <button
              type="button"
              className={secondary}
              disabled={busy === 'check'}
              onClick={() =>
                run(
                  'check',
                  async () => {
                    await refreshNursery()
                    return null
                  },
                  'Checked',
                )
              }
            >
              {notice.check || 'Check'}
            </button>
          </div>
        )}

        <form onSubmit={saveSurname} className="flex flex-col gap-2">
          <label htmlFor="surname" className="text-sm text-neutral-600">
            Surname
          </label>
          <div className="flex gap-2">
            <input
              id="surname"
              className={field}
              autoComplete="family-name"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
            />
            <button className={primary} disabled={busy === 'surname'}>
              Save
            </button>
          </div>
          {notice.surname && (
            <p role="status" className="text-sm text-green-700">
              {notice.surname}
            </p>
          )}
        </form>
      </Section>

      <Section title="Your name">
        <form onSubmit={saveName} className="flex flex-col gap-2">
          <label htmlFor="display-name" className="text-sm text-neutral-600">
            Display name
          </label>
          <div className="flex gap-2">
            <input
              id="display-name"
              className={field}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button className={primary} disabled={busy === 'name'}>
              Save
            </button>
          </div>
          {notice.name && (
            <p role="status" className="text-sm text-green-700">
              {notice.name}
            </p>
          )}
        </form>
      </Section>

      <Section title="Name filters">
        <p className="text-sm text-neutral-600">
          These filters apply to both of you. Changes affect the names each of you is shown next.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Gender (pick at least one)</legend>
          <div className="flex flex-wrap gap-2">
            {GENDERS.map((g) => (
              <Chip key={g} label={g} selected={genders.includes(g)} onClick={() => toggleGender(g)} />
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Origin (none selected = all origins)</legend>
          <div className="flex flex-wrap gap-2">
            {ORIGINS.map((o) => (
              <Chip
                key={o}
                label={o}
                selected={origins.includes(o)}
                onClick={() => setOrigins(toggle(origins, o))}
              />
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={primary}
            disabled={busy === 'filters' || !filtersChanged}
            onClick={saveFilters}
          >
            Save filters
          </button>
          {notice.filters && (
            <p role="status" className="text-sm text-green-700">
              {notice.filters}
            </p>
          )}
        </div>
      </Section>

      <Section title="Account">
        <p className="break-all text-neutral-800">
          Signed in as <span className="font-medium">{email ?? 'unknown'}</span>
        </p>
        <button
          type="button"
          className={secondary}
          disabled={busy === 'signout'}
          onClick={() =>
            run('signout', async () => {
              await signOut()
              return null
            })
          }
        >
          Sign out
        </button>
      </Section>

      <footer className="pb-4 text-center text-sm text-neutral-500">Swiper</footer>
    </div>
  )
}
