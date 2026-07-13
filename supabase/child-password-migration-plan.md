# Child Password Migration Plan

> **Status:** Pending — do not execute without a separate review and sign-off.
> **Scope:** Replace `children.password` plain-text storage with a hashed equivalent.
> **Constraint:** Child authentication must remain fully functional throughout.

---

## Problem

`children.password` stores plain-text passwords in the database. The `login_child` RPC compares them directly:

```sql
WHERE username = lower(p_username) AND password = p_password
```

The app caches the plain-text password in AsyncStorage (`@truzo/child`) and uses it for an offline fast-path check at `ChildLoginScreen.tsx:41`.

---

## Target state

- `children.password` column replaced by `children.password_hash` (SHA-256, same scheme as `passcode_hash`)
- `login_child` RPC updated to hash the incoming password and compare against `password_hash`
- `biometric_login_child` RPC updated to stop returning `password` in its result set
- App fast-path updated to compare hash (derived at login time) against cached hash
- `children.password` column dropped after migration

---

## Step 1 — Database: add `password_hash` column

```sql
ALTER TABLE children ADD COLUMN IF NOT EXISTS password_hash TEXT;
```

---

## Step 2 — Database: populate `password_hash` for existing rows

The hashing scheme used by the app is `SHA-256(userId + ':' + pin)` for passcodes (see `src/lib/passcode.ts`). For child passwords, the equivalent is `SHA-256(childId + ':' + password)`.

**Important:** PostgreSQL's built-in `pgcrypto` uses SHA-256 differently from the app's `expo-crypto` implementation. A one-time migration script (Node.js, not SQL) must:

1. Fetch all rows from `children` (id + password).
2. For each row, compute `SHA-256(id + ':' + password)` using Node's `crypto` module.
3. Update `children SET password_hash = computed_hash WHERE id = row.id`.
4. Verify all rows have `password_hash IS NOT NULL`.

```js
// Pseudocode — expand into a full scratchpad script before running
const crypto = require('crypto');
for (const { id, password } of rows) {
  const hash = crypto.createHash('sha256').update(`${id}:${password}`).digest('hex');
  await db.query('UPDATE children SET password_hash = $1 WHERE id = $2', [hash, id]);
}
```

---

## Step 3 — Database: update `login_child` RPC

Current signature: `login_child(p_username TEXT, p_password TEXT)`

Current body (simplified):
```sql
SELECT id, username, display_name, password, ...
FROM children
WHERE username = lower(p_username) AND password = p_password
```

New body:
```sql
-- Caller must pass the hash, not the plain password
SELECT id, username, display_name, ...   -- remove `password` from SELECT
FROM children
WHERE username = lower(p_username)
  AND password_hash = p_password_hash    -- rename param to make intent clear
```

**Or** — keep the plain-text parameter name for compatibility but hash it inside the RPC:
```sql
-- Hash incoming password server-side using pgcrypto sha256
-- BUT: this won't match expo-crypto's output — coordinate the scheme first
```

Recommended: accept `p_password_hash TEXT` (pre-hashed by the client) rather than hashing server-side, to keep the hash implementation in one place (the app).

---

## Step 4 — Database: update `biometric_login_child` RPC

This RPC currently returns `password` in its result. Remove that column from the `RETURNS TABLE` definition and the `SELECT` clause.

---

## Step 5 — App: hash password at login time

In `ChildLoginScreen.tsx`:

```typescript
// After successful login_child RPC call:
const hash = await hashPasscode(row.id, row.password); // reuse hashPasscode util
await cache.saveChild({ username: row.username, passwordHash: hash, childId: row.id });
```

Add `hashPasscode` (or a sibling `hashPassword`) that uses `expo-crypto` SHA-256:
```typescript
export function hashChildPassword(childId: string, password: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    childId + ':' + password,
  );
}
```

---

## Step 6 — App: update fast-path comparison

`ChildLoginScreen.tsx:41` currently:
```typescript
if (p === child.password && childId) { ... }
```

Replace with:
```typescript
const hash = await hashChildPassword(childId, p);
if (hash === child.passwordHash && childId) { ... }
```

---

## Step 7 — App: update cache schema

In `src/lib/cache.ts`, rename `password` → `passwordHash` in the child cache object. Update `saveChild()` and any reads from `child.password`.

---

## Step 8 — App: remove plain-text password display

Audit and remove any screen that displays `child.password` in plain text:
- `ParentAccountDetailsScreen` (if it shows child password) — remove the row
- `ChildSettingsScreen` (if it exists) — remove the row

---

## Step 9 — Database: clear `children.password` values

```sql
UPDATE children SET password = NULL WHERE password IS NOT NULL;
```

Verify:
```sql
SELECT COUNT(*) FROM children WHERE password IS NOT NULL; -- must be 0
```

---

## Step 10 — Database: drop `children.password` column

```sql
ALTER TABLE children DROP COLUMN IF EXISTS password;
```

Check for views/functions that reference it first (use `pg_depend` query pattern from Stage 2+3 migration).

---

## Rollback plan

At any point before Step 10, rollback is:
1. Revert RPC changes (redeploy prior versions via Supabase dashboard).
2. Revert app code (git revert).
3. Existing `children.password` column is untouched — authentication keeps working.

After Step 10 (column drop), rollback requires:
1. Restore from a pre-migration DB snapshot.
2. Re-run app changes.

**Recommendation:** Take a manual Supabase backup before Step 9.

---

## Testing checklist

- [ ] Child can log in with correct password via `login_child` RPC (online path)
- [ ] Child can log in with correct password via fast-path (offline/cached path)
- [ ] Wrong password is rejected in both paths
- [ ] Biometric (Face ID) login still works after `biometric_login_child` change
- [ ] Parent can view child account details (no `password` field shown)
- [ ] New child account created during onboarding can log in immediately
- [ ] Existing child accounts (migrated) can log in after Step 2

---

## Remaining technical debt (after this migration)

- `parent_passcode_hash` / `parent_passcode_created` / `parent_passcode_created_at` columns use bcrypt via `set_parent_passcode` / `verify_parent_passcode` RPCs — these are orphaned (the app uses `passcode_hash` via the SHA-256 path). Consider dropping these three columns and the two RPCs in a separate cleanup pass.
- `save_onboarding_data` RPC has 3 overloads in the DB; overloads 2 and 3 accept `p_password` and write to `parents.password` — but `parents.password` is now dropped, so these overloads will error if called. They should be dropped.
