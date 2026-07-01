# MR Chat — Cloud Functions

Secure backend for sensitive operations. Firestore Security Rules block direct writes to:
- `gold_transactions`, `diamond_transactions` (ledgers)
- `admin_logs`
- `role` field on `users`
- Mass operations

These Cloud Functions (running with Admin SDK, which bypasses security rules) are the **only** way to perform these operations.

## Functions exposed

| Function | Purpose |
|---|---|
| `transferGold` | User → user gold gift (atomic, balance-checked, rate-limited) |
| `transferDiamond` | User → user diamond gift |
| `grantGold` | Admin grants/removes gold from a user |
| `grantDiamond` | Admin grants/removes diamonds |
| `setRole` | Super-admin promotes/demotes a user (only `SUPER_ADMIN_UID` can call) |
| `setBanStatus` | Admin bans/unbans a user |
| `forceLogout` | Admin kicks a user from active session |
| `editUser` | Admin edits safe profile fields (gold/diamonds explicitly blocked) |
| `massDistribute` | Admin mass-distributes gold/diamond to many users (chunked) |
| `bulkBan` | Admin bulk-bans users |
| `onUserCreate` | Firestore trigger — forces safe defaults on new signup |
| `onUserDelete` | Firestore trigger — future cleanup hook |

## Deploy

```bash
# 1. Install Firebase CLI (one-time)
npm install -g firebase-tools

# 2. Login
firebase login

# 3. Install function deps
cd functions
npm install
cd ..

# 4. Deploy
firebase deploy --only functions
```

## Notes

- The Spark (free) plan supports these functions because they only touch Firestore (no external APIs). The 2M invocations/month free quota is plenty for early-stage chat apps.
- The `SUPER_ADMIN_UID` constant in `index.js` must match the one in `admin.html` (currently `6Vi1novyMhbM5BPw6onlFHFzIcc2`). Change both if needed.
- Rate limits are in-memory per-instance. For multi-instance production, swap with Upstash Redis (free tier, 10K commands/day).
