# MR Chat v3 — Bug Audit & Fixes

This document records bugs found during self-review of the Phase 1-3 codebase and how they were fixed.

## 🐛 Bugs Found & Fixed

### BUG 1: 2FA Flow Was Backwards (CRITICAL)
**Problem:** The original `verify2FA` CF used `action: 'check'` AFTER the user had already logged in with password. This meant:
- User logs in with password → then we check if 2FA is needed → if yes, sign them out and ask for code
- This is insecure because the password-authenticated session was already established

**Fix:**
- Added new `check2FARequired` CF (no auth required — takes email)
- Frontend flow now: (1) check2FARequired(email) → if required, show 2FA input → (2) signInWithEmailAndPassword → (3) verify2FA({ action: 'verify', code })
- The `verify2FA` CF no longer accepts `action: 'check'`

### BUG 2: Gift Pack Gold Logic Was Broken
**Problem:** In `purchaseItem` CF, the gift pack code did:
```js
updates.gold = FieldValue.increment(-item.price);  // initial deduction
// ...
if (item.bundleRewards.gold) {
  updates.gold = FieldValue.increment(item.bundleRewards.gold);  // OVERWRITES!
}
```
The second assignment **replaced** the first, so users would GET gold instead of paying for the bundle (negative price = profit).

**Fix:** Compute net change:
```js
const netGold = -item.price + bundleGold;
updates.gold = FieldValue.increment(netGold);
```

### BUG 3: scheduledDeleteOldMessages Was Too Expensive
**Problem:** Used `.get()` (full scan) on every chat collection, fetching ALL messages. For 1000 chats with 1000 messages each = 1M reads per day. Would blow the free tier in hours.

**Fix:** Use indexed query: `where('timestamp', '<', cutoff)`. Firestore only reads docs matching the filter. Requires composite index (added to `firestore.indexes.json`).

### BUG 4: Secret Chat — Sender Could Delete Messages
**Problem:** Rules allowed delete by either sender OR recipient. A malicious sender could delete their message before the recipient reads it (defeating burn-after-reading).

**Fix:** Restricted delete to **recipient only** (so recipient burns it after reading).

### BUG 5: onUserCreate Didn't Initialize New Fields
**Problem:** Phase 2/3 added fields like `equippedAvatar`, `stickerPacks`, `activeBoosts`, `autoreplyEnabled`, `has2FA`, etc. But `onUserCreate` only set role/gold/diamonds/etc. New users would have undefined fields → frontend crashes when reading `userData.stickerPacks.length`.

**Fix:** Updated `onUserCreate` to initialize all Phase 2/3 fields to safe defaults (empty array/object/false/null).

### BUG 6: autoReplyBot — Infinite Loop Risk
**Problem:** If both users have auto-reply enabled, every message would trigger an auto-reply which triggers another auto-reply... infinite loop.

**Fix:** Added:
- 60-second cooldown per recipient (in-memory map)
- Skip empty/system messages
- Skip recalled messages
- Explicit `recipientId === senderId` check (already existed, but moved earlier for clarity)

### BUG 7: recallMessage in inbox.html Used Direct Firestore Write
**Problem:** The existing `recallMessage()` function did `updateDoc(doc(collPath, msgId), {isRecalled: true, ...})`. But Firestore rules block direct message writes (recalled flag would be rejected).

**Fix:** Replaced with `recallMessageCF({ messageId, chatType, chatId })` call. The CF does authoritative ownership + window check + safe write.

### BUG 8 (partial): Feature Helpers Existed But No UI
**Problem:** `tryRecallMessage`, `tryTranslateMessage`, `tryTranscribeVoice`, `trySmartReply` helpers were added but no UI buttons existed to call them.

**Fix (partial):**
- `recallMessage()` now uses the CF (BUG 7 fix above)
- `logProfileVisitCF` hooked into `openSocialProfile` (BUG 9)
- Smart reply, translate, voice-to-text UI buttons still need adding (future task)

### BUG 9: logProfileVisitCF Was Never Called
**Problem:** CF existed, frontend had the helper imported, but `openSocialProfile()` never called it. So Profile Tracker feature was dead.

**Fix:** Added `logProfileVisitCF({ targetUid }).catch(() => {})` call inside `openSocialProfile()`.

### BUG 10: moderateContent CF Existed But Never Called
**Problem:** AI moderation CF was deployed but posts were saved without moderation check.

**Fix:** Added `moderateContentCF({ text })` call before `addDoc(collection(db, "posts"), ...)` in feed.html. Fail-open: if moderation service is down, post is still allowed.

### BUG 11: Communities Nav Still Navigable After CSS Hide
**Problem:** CSS hid the communities nav button visually, but clicking where it was still triggered `navigateTo('communities')` → broken view.

**Fix:** Intercept click handler — if `data-nav === 'communities'`, show toast "Communities are no longer available" instead of navigating.

### BUG 12: Missing Firestore Indexes
**Problem:** Username uniqueness check (`where('username', '==', ...)`) and email lookup (`where('email', '==', ...)`) were unindexed — slow scans on large user collections.

**Fix:** Added composite indexes to `firestore.indexes.json`:
- `users.username` (ASC)
- `users.email` (ASC)
- `scheduled_messages` (sent, scheduledAt)
- `profile_visits` (targetUid, timestamp DESC)

## 📊 Summary

| Severity | Count | Status |
|---|---|---|
| 🔴 Critical | 3 | ✅ Fixed |
| 🟡 High | 5 | ✅ Fixed |
| 🟢 Medium | 4 | ✅ Fixed |
| ⚠️ Low (partial) | 1 | Smart Reply / Translate UI buttons — deferred to Phase 4 |

**Total CFs now: 30** (was 29 — added `check2FARequired`)

## 🔍 Still To Do (Phase 4)

- [ ] Add UI button on incoming messages → trigger `tryTranslateMessage`
- [ ] Add smart reply chips above composer → trigger `trySmartReply`
- [ ] Add voice note transcription button → trigger `tryTranscribeVoice`
- [ ] Add 2FA setup/disable UI in account settings modal
- [ ] Add auto-reply settings UI (enable toggle + text input)
- [ ] Add scheduled message UI in chat composer (date/time picker)
- [ ] Add secret chat toggle in chat header (switches to E2E mode)
- [ ] Add profile tracker view (list of recent visitors)
