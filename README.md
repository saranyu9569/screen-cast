# VIEW — Visual Interface for Educational Workspace

Share PDF slides live: the instructor presents and draws, viewers follow along in their browser.

## Run locally

```bash
bun install
bun run add-account Instructor1   # first time only; prompts for a password
bun run server                    # API + WebSocket on :3001
bun run dev                       # app on :5173
```

Viewer page: `/` · Instructor page: `/#/instructor`

## Deploy to Railway

The Bun server serves the built app, the API and the WebSocket from one process.
`railway.json` already sets the build (`bun run build`) and start (`bun run start`) commands.

1. **New project** → *Deploy from GitHub repo* → pick this repository.
2. **Add a volume** to the service (right-click the service → *Attach volume*), mount path `/data`.
   Uploaded slides and instructor accounts live here, so they survive redeploys.
3. **Variables** tab, add:

   | Variable | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `INSTRUCTOR_USERNAME` | first instructor's username |
   | `INSTRUCTOR_PASSWORD` | their password (8+ characters) |

   The account is created on the first start, only while no accounts exist.
   After that you can delete `INSTRUCTOR_PASSWORD`; the stored password is hashed.
4. **Settings → Networking → Generate Domain** to get the public URL.

Add more instructors later from the service's shell (`railway ssh`): `bun run add-account <username>`.

Limits: one shared room; the current slide, drawings and logins reset when the server restarts (uploaded files and accounts on the volume stay).
