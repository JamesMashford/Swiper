import type { ScreenProps } from '../lib/types'

// Placeholder: replaced by the shortlist task.
export default function ShortlistScreen({ nursery }: ScreenProps) {
  return (
    <section className="flex h-full items-center justify-center p-6 text-neutral-600">
      Shortlist (placeholder) for {nursery.invite_code}
    </section>
  )
}
