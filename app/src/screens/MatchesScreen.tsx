import type { ScreenProps } from '../lib/types'

// Placeholder: replaced by the matches task.
export default function MatchesScreen({ nursery }: ScreenProps) {
  return (
    <section className="flex h-full items-center justify-center p-6 text-neutral-600">
      Matches (placeholder) for {nursery.invite_code}
    </section>
  )
}
