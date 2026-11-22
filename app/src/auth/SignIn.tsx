import { useState, type FormEvent } from 'react'
import { fieldClass, labelClass, primaryClass } from '../ui/styles'
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

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-5 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Swiper</h1>
        <p className="text-neutral-600">
          {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="auth-name" className={labelClass}>
              Your name
            </label>
            <input
              id="auth-name"
              className={fieldClass}
              type="text"
              placeholder="Your name"
              autoComplete="name"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="auth-email" className={labelClass}>
            Email
          </label>
          <input
            id="auth-email"
            className={fieldClass}
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="auth-password" className={labelClass}>
            Password
          </label>
          <input
            id="auth-password"
            className={fieldClass}
            type="password"
            placeholder="Password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {message && (
          <p role="alert" className="text-sm text-red-800">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className={primaryClass}
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="min-h-11 px-3 text-sm text-neutral-700 underline"
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
