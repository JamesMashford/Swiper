/** Shown whenever a request fails because the network or server is unreachable. */
export const OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again."

const NETWORK_RE =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|network error|err_internet_disconnected|err_network|authretryablefetch/i

/**
 * Turns raw library text (for example "TypeError: Failed to fetch") into something a person
 * can act on. Messages written for people (database errors we raise on purpose) pass through.
 */
export function friendlyError(raw: unknown): string {
  const text =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in raw
        ? String((raw as { message: unknown }).message ?? '')
        : ''
  if (!text.trim()) return 'Something went wrong. Please try again.'
  if (NETWORK_RE.test(text)) return OFFLINE_MESSAGE
  return text.replace(/^(Type|Range|Syntax)?Error:\s*/i, '')
}
