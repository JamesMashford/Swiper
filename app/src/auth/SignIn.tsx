import { useState, type FormEvent } from 'react'
import { useAuth } from './context'

export default function SignIn() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const result =
      mode === 'signin'
        ? await signIn(email, password)
        : await signUp(email, password, displayName.trim())
    setMessage(result)
    setBusy(false)
  }

  const field =
    'w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-900'

  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Swiper</h1>
        <p className="text-neutral-600">
          {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <input
            className={field}
            type="text"
            placeholder="Your name"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        )}
        <input
          className={field}
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={field}
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {message && (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-base font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="text-sm text-neutral-600 underline"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin')
          setMessage(null)
        }}
      >
        {mode === 'signin' ? "New here? Create an account" : 'Already have an account? Sign in'}
      </button>
    </main>
  )
}
