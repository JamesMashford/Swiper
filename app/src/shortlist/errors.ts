type Err = { code?: string; message: string } | null
type Res = { error: Err; status?: number }

export const MISSING_RPC = 'The database needs the latest update'

/** Turn a Supabase response error into a message people can act on. */
export function describeError(res: Res): string | null {
  const e = res.error
  if (!e) return null
  if (e.code === 'PGRST202' || res.status === 404 || /could not find the function/i.test(e.message)) {
    return MISSING_RPC
  }
  return e.message || 'Something went wrong'
}

/** Saves run one after another; screens wait for them before reloading. */
let tail: Promise<unknown> = Promise.resolve()
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job)
  tail = run.catch(() => undefined)
  return run
}
export function settled(): Promise<unknown> {
  return tail
}
