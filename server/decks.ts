// Every uploaded PDF, newest first, so instructors can reopen an earlier deck.
import { join } from 'node:path'
import { DATA_DIR } from './accounts'

export type Deck = { id: string; name: string; uploadedAt: string }

const DECKS_FILE = join(DATA_DIR, 'decks.json')

export async function loadDecks(): Promise<Deck[]> {
  const file = Bun.file(DECKS_FILE)
  return (await file.exists()) ? file.json() : []
}

export const saveDecks = (decks: Deck[]) => Bun.write(DECKS_FILE, JSON.stringify(decks, null, 2) + '\n')
