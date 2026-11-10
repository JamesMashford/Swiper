import type { ScreenProps } from '../lib/types'

// Placeholder: replaced by the settings task.
export default function SettingsScreen({ nursery }: ScreenProps) {
  return (
    <section className="flex h-full items-center justify-center p-6 text-neutral-600">
      Settings (placeholder) for {nursery.invite_code}
    </section>
  )
}
