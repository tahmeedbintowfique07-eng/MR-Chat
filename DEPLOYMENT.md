# MR Chat v3 — Deployment Guide

Complete step-by-step guide to deploy **MR Chat v3** with secure backend + expanded store + AI features + 2FA + PWA + Secret Chat + auto-delete.

## ⚠️ Deploy Order (CRITICAL)

1. **Cloud Functions first** — `firebase deploy --only functions`
2. **Firestore Rules second** — `firebase deploy --only firestore:rules`
3. **Frontend (Vercel) last** — `git push` (auto-deploys)

---

## Step 1 — Firebase Console Setup (one-time)

### A. Enable Google OAuth
1. Go to: https://console.firebase.google.com/project/mr-chatting-ff2b6/authentication/providers
2. Click **Google** → Enable → Select support email → Save

### B. Get reCAPTCHA keys (free)
1. Go to: https://www.google.com/recaptcha/admin
2. Create reCAPTCHA v2 (checkbox) site
3. Add your domain (localhost + your Vercel domain)
4. Copy **Site Key** and **Secret Key**

### C. Set reCAPTCHA secret as env var
```bash
firebase functions:secrets:set RECAPTCHA_SECRET
# Paste your secret key when prompted
```

### D. (Optional) Enable App Check with reCAPTCHA Enterprise
1. Go to: https://console.firebase.google.com/project/mr-chatting-ff2b6/appcheck
2. Register reCAPTCHA Enterprise site key
3. Update `firebase.json` → replace `YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY`
4. Enable enforcement for Firestore + Functions

### E. Update reCAPTCHA site key in frontend
In `index.html`, replace `YOUR_RECAPTCHA_V2_SITE_KEY` (2 occurrences):
- Line ~670: `<div class="g-recaptcha" data-sitekey="...">`
- Line ~1249: `const RECAPTCHA_SITE_KEY = '...'`

---

## Step 2 — Install Firebase CLI (one-time)

```bash
npm install -g firebase-tools
firebase login
```

## Step 3 — Deploy Cloud Functions

```bash
cd functions
npm install
cd ..

firebase deploy --only functions
```

This deploys **28 Cloud Functions**:

### Economy & Admin (Phase 1)
`transferGold`, `transferDiamond`, `grantGold`, `grantDiamond`, `setRole`, `setBanStatus`, `forceLogout`, `editUser`, `massDistribute`, `bulkBan`, `purchaseItem`, `onUserCreate`, `onUserDelete`

### Rewards & Messaging (Phase 2)
`rewardUser`, `recallMessage`

### AI Features (Phase 2 — uses z-ai-web-dev-sdk)
`translateMessage`, `transcribeVoice`, `smartReply`, `moderateContent`

### Tracking (Phase 2)
`logProfileVisit`

### 🆕 Auth & Security (Phase 3)
| Function | Purpose |
|---|---|
| `verifyRecaptcha` | Validates reCAPTCHA v2 token on signup |
| `setup2FA` | Generates TOTP secret + QR code |
| `verify2FA` | Verifies login code OR activates 2FA |
| `disable2FA` | Disables 2FA (requires valid code) |

### 🆕 Scheduled / Cron (Phase 3)
| Function | Schedule | Purpose |
|---|---|---|
| `scheduledDeleteOldMessages` | Daily 3 AM | Deletes chat messages >1 month old, keeps last 10 per chat |
| `messageScheduler` | Every minute | Sends messages scheduled by users |

### 🆕 Bot (Phase 3)
| Function | Trigger | Purpose |
|---|---|---|
| `autoReplyBot` | Firestore onMessageCreated | Sends user's preset auto-reply when they're away |

### 🆕 Secret Chat (Phase 3)
| Function | Purpose |
|---|---|
| `publishSecretChatKey` | Publishes user's E2E public key |
| `getSecretChatKey` | Fetches recipient's public key for encryption |

## Step 4 — Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## Step 5 — Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

## Step 6 — Push to GitHub (Vercel auto-deploys)

```bash
git add .
git commit -m "MR Chat v3: 28 CFs + 120 store items + 2FA + PWA + Secret Chat + auto-delete"
git push origin main
```

---

## 🔐 Auth Features

### Google OAuth
- One-click "Continue with Google" button on login screen
- First-time Google users auto-create account with email + photo
- Existing users just sign in (no duplicate accounts)

### reCAPTCHA v2 (signup bot protection)
- Visible on signup form
- Verified via `verifyRecaptcha` Cloud Function (secret server-side only)
- Bypass for existing user logins

### 2FA (TOTP)
- Users scan QR with Google Authenticator / Authy / 1Password
- 6-digit code required on every login (after password)
- Can be enabled/disabled in account settings
- Stored in `totp_secrets/{uid}` collection (CF-only writes)

### App Check (optional, recommended)
- Blocks non-browser clients from calling Firebase APIs
- Uses reCAPTCHA Enterprise (free)
- Configure in `firebase.json`

---

## 🗑️ Auto-Delete Chat History

The `scheduledDeleteOldMessages` Cloud Function runs **daily at 3 AM Asia/Dhaka**:
- For each **friendship chat** + **group room**:
  - If message count > 10:
    - Keeps the **most recent 10** messages
    - Deletes any message **older than 30 days** that isn't in the top 10
- Logs total messages deleted to Cloud Functions logs

This keeps Firestore usage low (free tier friendly) while preserving recent context.

---

## 🤫 Secret Chat (End-to-End Encrypted)

Uses **libsodium.js** (`crypto_box_easy` — Curve25519 + XSalsa20-Poly1305) loaded from CDN.

**Flow:**
1. Each user generates a keypair locally on first use (stored in `localStorage`)
2. Public key published to `secret_chat_keys/{uid}` via CF
3. To send: fetch recipient's public key → encrypt → store ciphertext in `secret_chats/{chatId}/messages`
4. To receive: Firestore listener triggers → decrypt with private key → display
5. **Burn after reading**: message is auto-deleted once decrypted by recipient

**Security:**
- Private key NEVER leaves the browser (localStorage only)
- Firestore rules ensure only sender + recipient can read messages
- Server only sees ciphertext (cannot decrypt)

**Purchase requirement:** User must buy "Secret Chat" from store (`special_secret` item, 120K diamonds).

---

## 📱 PWA Support

- `manifest.json` — installable on mobile/desktop
- `sw.js` — service worker (offline app shell + push notifications ready)
- Registered automatically in `index.html`
- Install prompt appears on Android Chrome + desktop Chrome
- iOS: "Add to Home Screen" works manually

---

## 🛍️ Store Catalog (120+ products, 16 categories)

See Phase 2 section for full catalog. Key additions in Phase 3:
- **Special Features** now include `secret_chat` (E2E), `recall` (5-min window), `translator` (AI), `voice_text` (AI), `autoreply` (bot), `scheduler`, `tracker` (profile visits), `invisible`, etc.
- All features verified server-side before use (Firestore rules + CF checks)

---

## 🚫 Removed Features

- **Communities** — removed from feed.html (UI hidden via CSS, code kept for future). `communitiesEnabled: false` by default.

---

## 🆓 Free Tier Limits

| Service | Free Quota | MR Chat v3 Usage (1K users) |
|---|---|---|
| Firebase Auth | Unlimited | OK |
| Firestore reads | 50K/day | ~15K/day (auto-delete keeps it low) |
| Firestore writes | 20K/day | ~6K/day |
| Cloud Functions | 2M invocations/month | ~250K |
| Cloud Functions (scheduled) | Free (limited invocations) | 2 cron jobs — OK |
| z-ai-web-dev-sdk | Per-platform quota | Generous |
| Vercel bandwidth | 100GB/month | OK |

---

## 🧪 Verification Checklist

### Auth
- [ ] Click "Google" button → Google popup → account created/logged in
- [ ] Signup form shows reCAPTCHA widget → must complete to submit
- [ ] Login with 2FA-enabled account → prompts for 6-digit code

### 2FA
- [ ] In settings: "Enable 2FA" → scan QR → enter code → 2FA active
- [ ] Logout → login → must enter 2FA code after password

### Auto-Delete
- [ ] Send 15+ messages in a chat → wait for next 3 AM run → verify only last 10 + recent remain
- [ ] Check Cloud Functions logs: `[scheduledDelete] Processed X chats, deleted Y messages`

### Secret Chat
- [ ] Both users buy "Secret Chat" from store
- [ ] Send secret message → recipient sees it once → auto-deleted after read
- [ ] Check Firestore: `secret_chats/{chatId}/messages` shows only ciphertext (no plaintext)

### PWA
- [ ] Open site on Android Chrome → "Install app" prompt appears
- [ ] After install: opens in standalone window, works offline (app shell)

### Scheduler + Auto-Reply
- [ ] Schedule a message for 2 min later → arrives on time
- [ ] Enable auto-reply + set text → friend sends message → auto-reply arrives after 2-5s

---

## 🐛 Troubleshooting

### reCAPTCHA widget doesn't show
- Verify `RECAPTCHA_SITE_KEY` is replaced in both places in `index.html`
- Check browser console for `grecaptcha is not defined` (script blocked?)

### 2FA setup fails with "internal"
- Verify `otplib` + `qrcode` installed: `cd functions && npm install`
- Check Cloud Functions logs: `firebase functions:log`

### Scheduled functions don't run
- Verify deployment: `firebase functions:list` (should show scheduledDeleteOldMessages + messageScheduler)
- Cloud Scheduler jobs are auto-created on deploy
- Check logs at: https://console.cloud.google.com/cloudscheduler

### Secret chat "Recipient has not set up secret chat"
- Recipient must open inbox at least once (auto-publishes their public key)
- Or call `publishSecretChatKeyCF` manually

### Google login "popup blocked"
- User must allow popups for the domain
- Alternative: use `signInWithRedirect` instead of `signInWithPopup` (edit `index.html`)

---

## 📋 Next Steps (Phase 4 — future)

- [ ] Web Push notifications (FCM + service worker push handler already in sw.js)
- [ ] Voice changer realtime (Web Audio API pitch shift)
- [ ] Group video calls (WebRTC mesh)
- [ ] Custom sticker upload (Cloud Storage)
- [ ] Move media to Cloudflare R2 (saves Firebase quota)
- [ ] AI image generation in chat
- [ ] Live translation (auto-translate every incoming message)

---

**Deploy now. v3 is fully loaded.** 🚀
