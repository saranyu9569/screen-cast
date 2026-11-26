// Instructor accounts: { lowercased username: argon2 hash }, kept out of git.
export const ACCOUNTS_FILE = new URL('../accounts.json', import.meta.url).pathname

export async function loadAccounts(): Promise<Record<string, string>> {
  const file = Bun.file(ACCOUNTS_FILE)
  return (await file.exists()) ? file.json() : {}
}
