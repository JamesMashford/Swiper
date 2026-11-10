import { useState, type FormEvent } from 'react'
import { fieldClass as field, labelClass, primaryClass as primary } from '../ui/styles'

type Props = {
  create: (surname: string) => Promise<string | null>
  join: (code: string) => Promise<string | null>
}

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
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Set up your nursery</h1>
        <p className="text-neutral-600">Start one and share the code, or join your partner's.</p>
      </div>

      <form onSubmit={onCreate} className="flex flex-col gap-3">
        <h2 className="font-medium">Start a nursery</h2>
        <label htmlFor="setup-surname" className={labelClass}>
          Surname (for previews)
        </label>
        <input
          id="setup-surname"
          className={field}
          placeholder="Surname (for previews)"
          autoComplete="family-name"
          maxLength={60}
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
        />
        <button className={primary} disabled={busy}>
          Create nursery
        </button>
      </form>

      <form onSubmit={onJoin} className="flex flex-col gap-3">
        <h2 className="font-medium">Join with a code</h2>
        <label htmlFor="setup-code" className={labelClass}>
          Invite code
        </label>
        <input
          id="setup-code"
          className={`${field} uppercase tracking-widest`}
          placeholder="BABY-7K2Q9XMD"
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
        <p role="alert" className="text-center text-sm text-red-800">
          {message}
        </p>
      )}
    </main>
  )
}
