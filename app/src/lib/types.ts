import type { Member, Nursery } from '../nursery/useNursery'

export type Gender = 'boy' | 'girl' | 'neutral'

export const GENDERS: Gender[] = ['boy', 'girl', 'neutral']

export const ORIGINS = [
  'English', 'Irish', 'Scottish', 'Welsh', 'French', 'Spanish', 'Italian', 'German',
  'Scandinavian', 'Greek', 'Latin', 'Hebrew', 'Arabic', 'Indian', 'Japanese', 'African',
  'Slavic', 'Celtic', 'Other',
] as const

export const STYLE_TAGS = [
  'classic', 'modern', 'vintage', 'nature', 'short', 'long', 'strong', 'soft', 'royal',
  'literary', 'biblical', 'mythological', 'unisex-feel', 'playful', 'elegant',
] as const

/** A name as returned by `suggest_names`. */
export type NameCard = {
  id: number
  name: string
  gender: Gender
  origins: string[]
  meaning: string | null
  style_tags: string[]
  syllables: number | null
  popularity: number
  blurb: string | null
}

export type MatchRow = { nursery_id: string; name_id: number; created_at: string }

/** A row of `shortlist_scores()`. */
export type ShortlistRow = {
  name_id: number
  name: string
  gender: Gender
  meaning: string | null
  my_position: number | null
  my_elo: number
  combined_rank: number
}

export type ScreenProps = {
  nursery: Nursery
  members: Member[]
  userId: string
  email: string | undefined
  /** Reload the nursery and members (call after changing nursery settings). */
  refreshNursery: () => Promise<void>
  signOut: () => Promise<void>
}

export type TabId = 'swipe' | 'matches' | 'shortlist' | 'settings'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'swipe', label: 'Swipe' },
  { id: 'matches', label: 'Matches' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'settings', label: 'Settings' },
]

/** The meaning text, or null when it is missing or the seed says it is uncertain. */
export function knownMeaning(meaning: string | null | undefined): string | null {
  if (!meaning || meaning.trim() === '' || meaning.trim() === 'Meaning uncertain') return null
  return meaning
}
