import { useState } from 'react'
import type { Member, Nursery } from './useNursery'

type Props = {
  nursery: Nursery
  members: Member[]
  userId: string
  email: string | undefined
  onRefresh: () => void
  onUpdateSurname: (surname: string) => Promise<string | null>
  onSignOut: () => void
}

export default function NurseryHome({
  nursery,
  members,
  userId,
  email,
  onRefresh,
  onUpdateSurname,
  onSignOut,
}: Props) {
  const [surname, setSurname] = useState(nursery.surname)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const partner = members.find((m) => m.user_id !== userId)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(nursery.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMessage('Could not copy. Select the code and copy it manually.')
    }
  }

  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Your nursery</h1>
        <p className="text-sm text-neutral-600">Signed in as {email}</p>
      </div>

      <section className="rounded-xl border border-neutral-200 p-4 text-center">
        <p className="text-sm text-neutral-600">
          {partner ? `Linked with ${partner.display_name}` : 'Share this code with your partner'}
        </p>
        <p className="my-2 select-all text-3xl font-semibold tracking-widest">
          {nursery.invite_code}
        </p>
        {!partner && (
          <div className="flex justify-center gap-4 text-sm">
            <button className="underline" onClick={copyCode}>
              {copied ? 'Copied' : 'Copy code'}
            </button>
            <button className="underline" onClick={onRefresh}>
              Check if they joined
            </button>
          </div>
        )}
      </section>

      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setMessage(await onUpdateSurname(surname.trim()))
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-900"
          placeholder="Surname"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
        />
        <button className="rounded-lg bg-neutral-900 px-3 py-2 text-white">Save</button>
      </form>

      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}

      <button className="text-sm underline" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  )
}
