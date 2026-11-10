import type { ScreenProps } from '../lib/types'

// Placeholder: replaced by the swipe task.
export default function SwipeScreen({ nursery }: ScreenProps) {
  return (
    <section className="flex h-full items-center justify-center p-6 text-neutral-600">
      Swipe (placeholder) for {nursery.invite_code}
    </section>
  )
}
