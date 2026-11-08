import { useState, type FormEvent } from 'react'

type Props = {
  create: (surname: string) => Promise<string | null>
  join: (code: string) => Promise<string | null>
}

const field =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-900'
const primary =
  'rounded-lg bg-neutral-900 px-3 py-2 text-base font-medium text-white disabled:opacity-60'

export default function NurserySetup({ create, join }: Props) {
  const [surname, setSurname] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function run(action: () => Promise<string | null>) {
    setBusy(true)
    setMessage(null)
    setMessage(await action())
    setBusy(false)
  }

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    run(() => create(surname.trim()))
  }
  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    run(() => join(code))
  }

  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Set up your nursery</h1>
        <p className="text-neutral-600">Start one and share the code, or join your partner's.</p>
      </div>

      <form onSubmit={onCreate} className="flex flex-col gap-3">
        <h2 className="font-medium">Start a nursery</h2>
        <input
          className={field}
          placeholder="Surname (for previews)"
          autoComplete="family-name"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
        />
        <button className={primary} disabled={busy}>
          Create nursery
        </button>
      </form>

      <form onSubmit={onJoin} className="flex flex-col gap-3">
        <h2 className="font-medium">Join with a code</h2>
        <input
          className={`${field} uppercase tracking-widest`}
          placeholder="BABY-7K2Q"
          autoCapitalize="characters"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button className={primary} disabled={busy}>
          Join nursery
        </button>
      </form>

      {message && (
        <p role="alert" className="text-center text-sm text-red-700">
          {message}
        </p>
      )}
    </main>
  )
}
