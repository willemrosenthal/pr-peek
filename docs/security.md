# Security and limits

How Git Buddy keeps tokens safe, and the limits it watches.

## GitHub tokens

We store each user's GitHub tokens encrypted with `TOKEN_ENC_KEY`. It's AES-256-GCM: a standard cipher that also catches changed data.

### Change the key

Do this if the key may have leaked.

1. Make a new key: `openssl rand -base64 32`
2. In Render, on both the web service and the worker:
   - Set `TOKEN_ENC_KEY_PREVIOUS` to the current key.
   - Set `TOKEN_ENC_KEY` to the new key.
3. Wait for both to deploy. Tokens now read with either key.
4. Open a Render shell on the web service and run:
   `pnpm --filter @pr-peek/server tokens:reencrypt`
   It encrypts every token again with the new key, and logs how many users it changed.
5. Remove `TOKEN_ENC_KEY_PREVIOUS` from both services.

The script is safe to run twice, and safe to run while the app is live.

## Logs

The logger hides secrets before they're written:

- Cookies and `Authorization` headers on requests.
- The request headers and body inside GitHub errors.
- Any field named like a token: `token`, `accessToken`, `refreshToken`, `access_token`, `refresh_token`, `client_secret`.

The list is in `apps/server/src/logger.ts`. Add to it if you log something new that holds a secret.

## Dependency audit

The **Audit** workflow checks our dependencies for known security problems. It runs on every PR and every Monday.

- It only checks what ships, and only high or critical problems.
- It isn't a required check, so it never blocks an unrelated PR.
- If it fails, update the package it names. Run it yourself with `pnpm audit --prod --audit-level high`.

## Supabase limits

We're on Supabase Pro. It includes:

| What              | Limit     | Warning at |
| ----------------- | --------- | ---------- |
| Database size     | 8 GB      | 70%        |
| Egress (data out) | 250 GB/mo | 80%        |

The admin page shows both. Past the database warning, admins get a push.

Pro also keeps daily backups for 7 days. Find them in Supabase under Database, Backups.

If the plan changes, update `DB_LIMIT_BYTES` in `apps/server/src/health.ts` and `EGRESS_LIMIT_BYTES` in `apps/server/src/admin.ts`.
