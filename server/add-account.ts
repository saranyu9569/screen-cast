// Usage: bun run add-account <username>   (prompts for the password; re-running updates it)
import { ACCOUNTS_FILE, loadAccounts } from './accounts'

const username = process.argv[2]?.trim()
if (!username) throw new Error('Usage: bun run add-account <username>')
const password = prompt('Password:')
if (!password || password.length < 8) throw new Error('Password must be at least 8 characters')

const accounts = await loadAccounts()
accounts[username.toLowerCase()] = await Bun.password.hash(password)
await Bun.write(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + '\n')
console.log(`Saved account "${username}" to ${ACCOUNTS_FILE}`)
