// Usage: bun run add-account <username>   (prompts for the password; re-running updates it)
import { ACCOUNTS_FILE, saveAccount } from './accounts'

const username = process.argv[2]?.trim()
if (!username) throw new Error('Usage: bun run add-account <username>')
const password = prompt('Password:')
if (!password || password.length < 8) throw new Error('Password must be at least 8 characters')

await saveAccount(username, password)
console.log(`Saved account "${username}" to ${ACCOUNTS_FILE}`)
