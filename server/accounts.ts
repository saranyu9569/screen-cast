// Instructor accounts: { lowercased username: argon2 hash }, kept out of git.
import { join } from 'node:path'

// Where uploads and accounts live. On Railway, point this at a mounted volume so they survive redeploys.
export const DATA_DIR = process.env.DATA_DIR || new URL('..', import.meta.url).pathname
export const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json')

export async function loadAccounts(): Promise<Record<string, string>> {
  const file = Bun.file(ACCOUNTS_FILE)
  return (await file.exists()) ? file.json() : {}
}

export async function saveAccount(username: string, password: string) {
  const accounts = await loadAccounts()
  accounts[username.toLowerCase()] = await Bun.password.hash(password)
  await Bun.write(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + '\n')
}
