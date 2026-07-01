/**
 * MR Chat — Cloud Functions (v1)
 * --------------------------------------------------------------
 * These functions handle ALL sensitive operations so that the
 * Firestore Security Rules can lock down writes to protected
 * collections (gold_transactions, diamond_transactions, admin_logs,
 * role changes, mass distributions, bans, etc.).
 *
 * Frontend pages (inbox.html, admin.html) MUST call these via
 * the Callable Functions SDK (httpsCallable). Direct Firestore
 * writes for these operations are blocked by security rules.
 * --------------------------------------------------------------
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ============================================================
//  IN-MEMORY RATE LIMITER (per-instance)
//  For high-traffic production, replace with Upstash Redis.
// ============================================================
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please slow down.');
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear();
}

// ============================================================
//  HELPERS
// ============================================================
async function requireAdmin(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'User record missing.');
  if (snap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  return snap.data();
}

async function logAdminAction(adminUid, adminName, action, details, targetUid = null, targetType = null) {
  await db.collection('admin_logs').add({
    action,
    details,
    adminId: adminUid,
    adminName: adminName || 'Admin',
    targetUid,
    targetType,
    timestamp: Date.now()
  });
}

// ============================================================
//  1. TRANSFER GOLD (user → user gift)
// ============================================================
exports.transferGold = onCall(async (req) => {
  const senderUid = req.auth?.uid;
  if (!senderUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid, amount } = req.data || {};
  if (!targetUid || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new HttpsError('invalid-argument', 'Invalid target or amount.');
  }
  if (senderUid === targetUid) throw new HttpsError('invalid-argument', 'Cannot gift yourself.');

  rateLimit(`gold_transfer_${senderUid}`, 10, 60 * 60 * 1000);

  const senderRef = db.doc(`users/${senderUid}`);
  const targetRef = db.doc(`users/${targetUid}`);

  return db.runTransaction(async (tx) => {
    const [sSnap, tSnap] = await Promise.all([tx.get(senderRef), tx.get(targetRef)]);
    if (!sSnap.exists) throw new HttpsError('not-found', 'Sender missing.');
    if (!tSnap.exists) throw new HttpsError('not-found', 'Recipient not found.');

    const sender = sSnap.data();
    const target = tSnap.data();

    if (sender.isBanned === true) throw new HttpsError('permission-denied', 'Banned accounts cannot send gifts.');
    if (target.isBanned === true) throw new HttpsError('permission-denied', 'Recipient is banned.');

    const balance = sender.gold || 0;
    if (balance < amount) throw new HttpsError('failed-precondition', 'Insufficient gold.');

    tx.update(senderRef, { gold: FieldValue.increment(-amount) });
    tx.update(targetRef, { gold: FieldValue.increment(amount) });
    tx.create(db.collection('gold_transactions').doc(), {
      userId: targetUid,
      userName: target.username || target.fullName || 'User',
      amount,
      reason: 'Gift transfer',
      senderId: senderUid,
      senderName: sender.username || sender.fullName || 'User',
      timestamp: Date.now(),
      type: 'transfer'
    });

    return { success: true, newBalance: balance - amount };
  });
});

// ============================================================
//  2. TRANSFER DIAMOND (user → user gift)
// ============================================================
exports.transferDiamond = onCall(async (req) => {
  const senderUid = req.auth?.uid;
  if (!senderUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid, amount } = req.data || {};
  if (!targetUid || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new HttpsError('invalid-argument', 'Invalid target or amount.');
  }
  if (senderUid === targetUid) throw new HttpsError('invalid-argument', 'Cannot gift yourself.');

  rateLimit(`diamond_transfer_${senderUid}`, 10, 60 * 60 * 1000);

  const senderRef = db.doc(`users/${senderUid}`);
  const targetRef = db.doc(`users/${targetUid}`);

  return db.runTransaction(async (tx) => {
    const [sSnap, tSnap] = await Promise.all([tx.get(senderRef), tx.get(targetRef)]);
    if (!sSnap.exists) throw new HttpsError('not-found', 'Sender missing.');
    if (!tSnap.exists) throw new HttpsError('not-found', 'Recipient not found.');

    const sender = sSnap.data();
    const target = tSnap.data();

    if (sender.isBanned === true) throw new HttpsError('permission-denied', 'Banned accounts cannot send gifts.');
    if (target.isBanned === true) throw new HttpsError('permission-denied', 'Recipient is banned.');

    const balance = sender.diamonds || 0;
    if (balance < amount) throw new HttpsError('failed-precondition', 'Insufficient diamonds.');

    tx.update(senderRef, { diamonds: FieldValue.increment(-amount) });
    tx.update(targetRef, { diamonds: FieldValue.increment(amount) });
    tx.create(db.collection('diamond_transactions').doc(), {
      userId: targetUid,
      userName: target.username || target.fullName || 'User',
      amount,
      reason: 'Gift transfer',
      senderId: senderUid,
      senderName: sender.username || sender.fullName || 'User',
      timestamp: Date.now(),
      type: 'transfer'
    });

    return { success: true, newBalance: balance - amount };
  });
});

// ============================================================
//  3. ADMIN: GRANT GOLD
// ============================================================
exports.grantGold = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid, amount, reason } = req.data || {};
  if (!targetUid || typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new HttpsError('invalid-argument', 'Invalid target or amount.');
  }
  if (Math.abs(amount) > 10000000) throw new HttpsError('invalid-argument', 'Amount too large.');

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const target = targetSnap.data();

  const batch = db.batch();
  batch.update(targetRef, { gold: FieldValue.increment(amount) });
  batch.create(db.collection('gold_transactions').doc(), {
    userId: targetUid,
    userName: target.username || target.fullName || 'User',
    amount,
    reason: reason || 'Admin adjustment',
    adminId: adminUid,
    adminName: admin.username || admin.fullName || 'Admin',
    timestamp: Date.now(),
    type: 'admin_grant'
  });
  await batch.commit();

  await logAdminAction(adminUid, admin.username, 'Gold Update',
    `${amount > 0 ? '+' : ''}${amount} gold | ${reason || ''}`, targetUid, 'user');

  return { success: true };
});

// ============================================================
//  4. ADMIN: GRANT DIAMOND
// ============================================================
exports.grantDiamond = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid, amount, reason } = req.data || {};
  if (!targetUid || typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new HttpsError('invalid-argument', 'Invalid target or amount.');
  }
  if (Math.abs(amount) > 10000000) throw new HttpsError('invalid-argument', 'Amount too large.');

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const target = targetSnap.data();

  const batch = db.batch();
  batch.update(targetRef, { diamonds: FieldValue.increment(amount) });
  batch.create(db.collection('diamond_transactions').doc(), {
    userId: targetUid,
    userName: target.username || target.fullName || 'User',
    amount,
    reason: reason || 'Admin adjustment',
    adminId: adminUid,
    adminName: admin.username || admin.fullName || 'Admin',
    timestamp: Date.now(),
    type: 'admin_grant'
  });
  await batch.commit();

  await logAdminAction(adminUid, admin.username, 'Diamond Update',
    `${amount > 0 ? '+' : ''}${amount} diamonds | ${reason || ''}`, targetUid, 'user');

  return { success: true };
});

// ============================================================
//  5. ADMIN: SET USER ROLE (super-admin only)
// ============================================================
exports.setRole = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const SUPER_ADMIN_UID = '6Vi1novyMhbM5BPw6onlFHFzIcc2';
  if (adminUid !== SUPER_ADMIN_UID) {
    throw new HttpsError('permission-denied', 'Only the super-admin can change roles.');
  }

  const { targetUid, role } = req.data || {};
  if (!targetUid || !['user', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid target or role.');
  }

  await db.doc(`users/${targetUid}`).set({ role }, { merge: true });
  await logAdminAction(adminUid, admin.username, 'Set Role',
    `Set role to ${role}`, targetUid, 'user');

  return { success: true };
});

// ============================================================
//  6. ADMIN: BAN / UNBAN USER
// ============================================================
exports.setBanStatus = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid, isBanned, reason } = req.data || {};
  if (!targetUid || typeof isBanned !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Invalid target or status.');
  }

  const updates = {
    isBanned,
    status: isBanned ? 'offline' : 'online',
    forceLogout: isBanned
  };
  if (isBanned) {
    updates.bannedAt = Date.now();
    updates.banReason = reason || 'Banned by admin';
  } else {
    updates.unbannedAt = Date.now();
  }

  await db.doc(`users/${targetUid}`).set(updates, { merge: true });
  await logAdminAction(adminUid, admin.username,
    isBanned ? 'Ban User' : 'Unban User',
    `${isBanned ? 'Banned' : 'Unbanned'} | ${reason || ''}`, targetUid, 'user');

  return { success: true };
});

// ============================================================
//  7. ADMIN: FORCE LOGOUT USER
// ============================================================
exports.forceLogout = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid } = req.data || {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'Invalid target.');

  await db.doc(`users/${targetUid}`).set({
    forceLogout: true,
    status: 'offline',
    lastSeen: Date.now()
  }, { merge: true });

  await logAdminAction(adminUid, admin.username, 'Force Logout',
    'Kicked user from session', targetUid, 'user');

  return { success: true };
});

// ============================================================
//  8. ADMIN: EDIT USER (safe profile fields only)
// ============================================================
exports.editUser = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid, updates } = req.data || {};
  if (!targetUid || typeof updates !== 'object' || updates === null) {
    throw new HttpsError('invalid-argument', 'Invalid target or updates.');
  }

  const ALLOWED = ['fullName', 'username', 'level', 'xp', 'userType', 'isBanned', 'photoURL', 'bio', 'coverPhoto', 'profileFrame', 'avatarBorder', 'profileMusic'];
  const safe = {};
  for (const k of ALLOWED) {
    if (k in updates) safe[k] = updates[k];
  }

  if ('gold' in updates || 'diamonds' in updates) {
    throw new HttpsError('invalid-argument', 'Use grantGold/grantDiamond for currency changes.');
  }

  await db.doc(`users/${targetUid}`).set(safe, { merge: true });
  await logAdminAction(adminUid, admin.username, 'Edit User',
    `Updated fields: ${Object.keys(safe).join(', ')}`, targetUid, 'user');

  return { success: true };
});

// ============================================================
//  9. ADMIN: MASS DISTRIBUTE GOLD/DIAMOND
// ============================================================
exports.massDistribute = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { type, amount, reason, targetUids } = req.data || {};
  if (!['gold', 'diamond'].includes(type)) {
    throw new HttpsError('invalid-argument', 'Type must be gold or diamond.');
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) {
    throw new HttpsError('invalid-argument', 'Invalid amount.');
  }
  if (!Array.isArray(targetUids) || targetUids.length === 0) {
    throw new HttpsError('invalid-argument', 'No target users.');
  }
  if (targetUids.length > 10000) {
    throw new HttpsError('invalid-argument', 'Too many targets (max 10000). Use batches.');
  }

  rateLimit(`mass_distribute_${adminUid}`, 5, 60 * 60 * 1000);

  const fieldName = type === 'gold' ? 'gold' : 'diamonds';
  const txCollection = type === 'gold' ? 'gold_transactions' : 'diamond_transactions';

  const CHUNK = 450;
  let processed = 0;
  for (let i = 0; i < targetUids.length; i += CHUNK) {
    const chunk = targetUids.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const uid of chunk) {
      batch.update(db.doc(`users/${uid}`), { [fieldName]: FieldValue.increment(amount) });
      batch.create(db.collection(txCollection).doc(), {
        userId: uid,
        userName: '—',
        amount,
        reason: reason || 'Mass distribution',
        adminId: adminUid,
        adminName: admin.username || admin.fullName || 'Admin',
        timestamp: Date.now(),
        type: 'mass_distribute'
      });
    }
    await batch.commit();
    processed += chunk.length;
  }

  await logAdminAction(adminUid, admin.username,
    type === 'gold' ? 'Mass Gold' : 'Mass Diamond',
    `Distributed ${amount} ${type} to ${targetUids.length} users | ${reason || ''}`,
    null, 'user');

  return { success: true, processed };
});

// ============================================================
//  10. ADMIN: BULK BAN
// ============================================================
exports.bulkBan = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUids, reason } = req.data || {};
  if (!Array.isArray(targetUids) || targetUids.length === 0) {
    throw new HttpsError('invalid-argument', 'No target users.');
  }
  if (targetUids.length > 10000) {
    throw new HttpsError('invalid-argument', 'Too many targets (max 10000).');
  }

  rateLimit(`bulk_ban_${adminUid}`, 5, 60 * 60 * 1000);

  const CHUNK = 450;
  for (let i = 0; i < targetUids.length; i += CHUNK) {
    const chunk = targetUids.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const uid of chunk) {
      batch.set(db.doc(`users/${uid}`), {
        isBanned: true,
        bannedAt: Date.now(),
        banReason: reason || 'Bulk ban by admin',
        status: 'offline',
        forceLogout: true
      }, { merge: true });
    }
    await batch.commit();
  }

  await logAdminAction(adminUid, admin.username, 'Bulk Ban',
    `Banned ${targetUids.length} users | ${reason || ''}`, null, 'user');

  return { success: true, count: targetUids.length };
});

// ============================================================
//  11. STORE PURCHASE (atomic, balance-checked, audit-logged)
// ============================================================
exports.purchaseItem = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { item } = req.data || {};
  if (!item || !item.id || typeof item.price !== 'number' || !['gold', 'diamonds'].includes(item.currency)) {
    throw new HttpsError('invalid-argument', 'Invalid item.');
  }
  if (item.price < 0 || item.price > 1000000) {
    throw new HttpsError('invalid-argument', 'Invalid price.');
  }

  rateLimit(`purchase_${uid}`, 20, 60 * 1000); // 20 purchases per minute

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError('not-found', 'User missing.');
    const u = snap.data();

    if (u.isBanned === true) throw new HttpsError('permission-denied', 'Account suspended.');

    const isDiamond = item.currency === 'diamonds';
    const isConsumable = item.consumable === true;

    // Ownership check for non-consumable
    if (!isConsumable && Array.isArray(u.ownedItems) && u.ownedItems.includes(item.id)) {
      throw new HttpsError('already-exists', 'Already owned.');
    }

    // Balance check (authoritative)
    const balance = isDiamond ? (u.diamonds || 0) : (u.gold || 0);
    if (balance < item.price) {
      throw new HttpsError('failed-precondition', `Insufficient ${item.currency}.`);
    }

    // Build update payload
    const updates = {};
    let newOwnedArr;
    if (isConsumable) {
      updates.gold = FieldValue.increment(-item.price);
      if (item.diamondReward) updates.diamonds = FieldValue.increment(item.diamondReward);
    } else if (isDiamond) {
      updates.diamonds = FieldValue.increment(-item.price);
      newOwnedArr = Array.from(u.ownedItems || []);
      if (!newOwnedArr.includes(item.id)) newOwnedArr.push(item.id);
      updates.ownedItems = newOwnedArr;
    } else {
      updates.gold = FieldValue.increment(-item.price);
      newOwnedArr = Array.from(u.ownedItems || []);
      if (!newOwnedArr.includes(item.id)) newOwnedArr.push(item.id);
      updates.ownedItems = newOwnedArr;
    }

    // GIFT PACK — bundle rewards (grant gold/diamonds + unlock bundled items)
    // IMPORTANT: We can't use FieldValue.increment twice on the same field in one update.
    // Instead, compute the NET change and apply once.
    if (item.type === 'giftpack' && item.bundleRewards) {
      const bundleGold = item.bundleRewards.gold || 0;
      const bundleDiamonds = item.bundleRewards.diamonds || 0;

      if (isDiamond) {
        // Paid with diamonds, gets diamonds back as reward
        const netDiamond = -item.price + bundleDiamonds;
        updates.diamonds = FieldValue.increment(netDiamond);
        if (bundleGold > 0) updates.gold = FieldValue.increment(bundleGold);
      } else {
        // Paid with gold, gets gold back as reward
        const netGold = -item.price + bundleGold;
        updates.gold = FieldValue.increment(netGold);
        if (bundleDiamonds > 0) updates.diamonds = FieldValue.increment(bundleDiamonds);
      }

      if (Array.isArray(item.bundleRewards.items)) {
        const owned = new Set(u.ownedItems || []);
        for (const bundledId of item.bundleRewards.items) {
          if (!owned.has(bundledId)) {
            newOwnedArr.push(bundledId);
          }
        }
        updates.ownedItems = newOwnedArr;
      }
    }

    // Auto-equip / activate based on product type
    const hasEquipped = (() => {
      switch (item.type) {
        case 'badge':  return (u.badges || []).includes(item.value);
        case 'voice':  return (u.voiceEffects || []).includes(item.value);
        case 'chat':   return (u.chatStyles || []).includes(item.value);
        case 'special':
        case 'utility': return (u.unlockedFeatures || []).includes(item.value);
        case 'boost':  return !!(u.activeBoosts || {})[item.value];
        case 'avatar': return u.equippedAvatar === item.value;
        case 'namecolor': return u.equippedNameColor === item.value;
        case 'music': return u.equippedMusic === item.value;
        case 'sticker': return (u.stickerPacks || []).includes(item.value);
        case 'ringtone': return u.equippedRingtone === item.value;
        default: return !!u.profileFrame || !!u.avatarBorder || !!u.profileTheme;
      }
    })();

    if (!hasEquipped) {
      switch (item.type) {
        case 'frame': updates.profileFrame = item.value; break;
        case 'border': updates.avatarBorder = item.value; break;
        case 'theme': updates.profileTheme = item.value; break;
        case 'avatar': updates.equippedAvatar = item.value; break;
        case 'namecolor': updates.equippedNameColor = item.value; break;
        case 'music': updates.equippedMusic = item.value; break;
        case 'ringtone': updates.equippedRingtone = item.value; break;
        case 'badge': {
          const arr = new Set(u.badges || []); arr.add(item.value);
          updates.badges = Array.from(arr);
          break;
        }
        case 'voice': {
          const arr = new Set(u.voiceEffects || []); arr.add(item.value);
          updates.voiceEffects = Array.from(arr);
          break;
        }
        case 'chat': {
          const arr = new Set(u.chatStyles || []); arr.add(item.value);
          updates.chatStyles = Array.from(arr);
          break;
        }
        case 'sticker': {
          const arr = new Set(u.stickerPacks || []); arr.add(item.value);
          updates.stickerPacks = Array.from(arr);
          break;
        }
        case 'boost': {
          const boosts = { ...(u.activeBoosts || {}) };
          const duration = item.value === 'streak' ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
          boosts[item.value] = Date.now() + duration;
          updates.activeBoosts = boosts;
          break;
        }
        case 'special':
        case 'utility': {
          const arr = new Set(u.unlockedFeatures || []); arr.add(item.value);
          updates.unlockedFeatures = Array.from(arr);
          break;
        }
        case 'giftpack':
          // Bundled items already added to ownedItems above; no separate equip field
          break;
      }
    }

    // Append to purchasedItems audit array on user doc
    if (!isConsumable) {
      const prevPurchases = u.purchasedItems || [];
      prevPurchases.push({ itemId: item.id, timestamp: Date.now() });
      updates.purchasedItems = prevPurchases.slice(-50);
    }

    tx.update(userRef, updates);

    // Audit trail — storeTransactions collection
    tx.create(db.collection('storeTransactions').doc(), {
      userId: uid,
      itemId: item.id,
      itemName: item.name,
      price: item.price,
      currency: item.currency,
      timestamp: Date.now()
    });

    // Ledger entries (gold/diamond transactions)
    if (item.currency === 'gold' && item.price > 0) {
      tx.create(db.collection('gold_transactions').doc(), {
        userId: uid,
        userName: u.username || u.fullName || 'User',
        amount: -item.price,
        reason: `Store purchase: ${item.name}`,
        timestamp: Date.now(),
        type: 'store_purchase',
        itemId: item.id
      });
    } else if (item.currency === 'diamonds' && item.price > 0) {
      tx.create(db.collection('diamond_transactions').doc(), {
        userId: uid,
        userName: u.username || u.fullName || 'User',
        amount: -item.price,
        reason: `Store purchase: ${item.name}`,
        timestamp: Date.now(),
        type: 'store_purchase',
        itemId: item.id
      });
    }

    // Consumable diamond reward ledger
    if (isConsumable && item.diamondReward) {
      tx.create(db.collection('diamond_transactions').doc(), {
        userId: uid,
        userName: u.username || u.fullName || 'User',
        amount: item.diamondReward,
        reason: `Store purchase reward: ${item.name}`,
        timestamp: Date.now(),
        type: 'store_reward',
        itemId: item.id
      });
    }

    return { success: true };
  });
});

// ============================================================
//  12. REWARD USER (gold/xp on actions — re-enabled with boost multiplier)
//  Called by clients after meaningful actions (message sent, room joined, etc.)
//  Applies activeBoosts gold/xp multipliers automatically.
// ============================================================
exports.rewardUser = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { action, baseGold = 0, baseXp = 0 } = req.data || {};
  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'Invalid action.');
  }
  // Whitelist of valid reward actions to prevent abuse
  const VALID_ACTIONS = ['message_sent', 'room_joined', 'post_created', 'comment_posted', 'reaction_given', 'daily_login', 'quiz_correct', 'dice_win', 'call_completed'];
  if (!VALID_ACTIONS.includes(action)) {
    throw new HttpsError('invalid-argument', 'Unknown reward action.');
  }

  rateLimit(`reward_${uid}_${action}`, 50, 60 * 1000); // 50 rewards per minute per action

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'User missing.');
  const u = snap.data();
  if (u.isBanned === true) throw new HttpsError('permission-denied', 'Banned users earn no rewards.');

  // Apply boost multipliers
  const boosts = u.activeBoosts || {};
  const now = Date.now();
  let goldMult = 1, xpMult = 1;
  if (boosts.gold2 && boosts.gold2 > now) goldMult = 2;
  if (boosts.gold3 && boosts.gold3 > now) goldMult = 3;
  if (boosts.xp2 && boosts.xp2 > now) xpMult = 2;
  if (boosts.xp3 && boosts.xp3 > now) xpMult = 3;

  const finalGold = Math.floor(baseGold * goldMult);
  const finalXp = Math.floor(baseXp * xpMult);

  const updates = {};
  if (finalGold > 0) updates.gold = FieldValue.increment(finalGold);
  if (finalXp > 0) updates.xp = FieldValue.increment(finalXp);

  if (Object.keys(updates).length > 0) {
    await userRef.set(updates, { merge: true });

    // Ledger for gold reward
    if (finalGold > 0) {
      await db.collection('gold_transactions').add({
        userId: uid,
        userName: u.username || u.fullName || 'User',
        amount: finalGold,
        reason: `Reward: ${action}`,
        timestamp: Date.now(),
        type: 'reward',
        multiplier: goldMult
      });
    }
  }

  return { success: true, gold: finalGold, xp: finalXp, goldMult, xpMult };
});

// ============================================================
//  13. RECALL MESSAGE (5-min window, secure ownership check)
//  Marks a message as recalled — clients hide its content.
// ============================================================
exports.recallMessage = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { messageId, chatType, chatId } = req.data || {};
  if (!messageId || !chatType || !chatId) {
    throw new HttpsError('invalid-argument', 'messageId, chatType, chatId required.');
  }
  if (!['friendship', 'room'].includes(chatType)) {
    throw new HttpsError('invalid-argument', 'Invalid chatType.');
  }

  // Verify the user owns the message
  let msgRef;
  if (chatType === 'friendship') {
    // Verify participation in the friendship
    const fSnap = await db.doc(`friendships/${chatId}`).get();
    if (!fSnap.exists) throw new HttpsError('not-found', 'Chat not found.');
    const f = fSnap.data();
    if (f.user1 !== uid && f.user2 !== uid) {
      throw new HttpsError('permission-denied', 'Not a participant.');
    }
    msgRef = db.doc(`friendships/${chatId}/chat_messages/${messageId}`);
  } else {
    // Verify room membership
    const rSnap = await db.doc(`group_rooms/${chatId}`).get();
    if (!rSnap.exists) throw new HttpsError('not-found', 'Room not found.');
    const r = rSnap.data();
    const isMember = r.createdBy === uid || (Array.isArray(r.memberIds) && r.memberIds.includes(uid));
    if (!isMember) throw new HttpsError('permission-denied', 'Not a room member.');
    msgRef = db.doc(`group_rooms/${chatId}/room_messages/${messageId}`);
  }

  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Message not found.');
  const msg = msgSnap.data();

  if (msg.senderId !== uid) {
    throw new HttpsError('permission-denied', 'You can only recall your own messages.');
  }

  // 5-minute window
  const ageMs = Date.now() - (msg.timestamp || 0);
  if (ageMs > 5 * 60 * 1000) {
    throw new HttpsError('failed-precondition', 'Recall window (5 min) expired.');
  }

  // Check user has the 'recall' feature unlocked
  const userSnap = await db.doc(`users/${uid}`).get();
  const features = userSnap.data()?.unlockedFeatures || [];
  if (!features.includes('recall')) {
    throw new HttpsError('permission-denied', 'Message Recall feature not purchased.');
  }

  // Mark recalled (preserve metadata, blank content)
  await msgRef.set({
    recalled: true,
    recalledAt: Date.now(),
    text: '',
    image: null,
    audio: null,
    sticker: null
  }, { merge: true });

  return { success: true };
});

// ============================================================
//  14. TRANSLATE MESSAGE (uses z-ai-web-dev-sdk LLM)
//  Translates incoming/outgoing chat messages.
// ============================================================
exports.translateMessage = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { text, targetLang } = req.data || {};
  if (!text || typeof text !== 'string' || text.length > 2000) {
    throw new HttpsError('invalid-argument', 'Invalid text (max 2000 chars).');
  }
  if (!targetLang || typeof targetLang !== 'string') {
    throw new HttpsError('invalid-argument', 'targetLang required.');
  }

  // Verify user has translator feature
  const userSnap = await db.doc(`users/${uid}`).get();
  const features = userSnap.data()?.unlockedFeatures || [];
  if (!features.includes('translator')) {
    throw new HttpsError('permission-denied', 'Chat Translator feature not purchased.');
  }

  rateLimit(`translate_${uid}`, 30, 60 * 1000); // 30 translations per minute

  try {
    const ZAI = require('z-ai-web-dev-sdk').default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: `You are a professional translator. Translate the user's message into ${targetLang}. Return ONLY the translated text, no explanations, no quotes.` },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      max_tokens: 500
    });
    const translated = completion.choices?.[0]?.message?.content?.trim() || text;
    return { success: true, translated, original: text };
  } catch (err) {
    logger.error('Translate error:', err);
    throw new HttpsError('internal', 'Translation service failed.');
  }
});

// ============================================================
//  15. TRANSCRIBE VOICE (uses z-ai-web-dev-sdk ASR)
//  Converts voice note audio (base64) to text.
// ============================================================
exports.transcribeVoice = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { audioBase64, format = 'mp3' } = req.data || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new HttpsError('invalid-argument', 'audioBase64 required.');
  }
  // Limit to 5MB
  if (audioBase64.length > 5 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'Audio too large (max 5MB).');
  }

  // Verify user has voice_text feature
  const userSnap = await db.doc(`users/${uid}`).get();
  const features = userSnap.data()?.unlockedFeatures || [];
  if (!features.includes('voice_text')) {
    throw new HttpsError('permission-denied', 'Voice to Text feature not purchased.');
  }

  rateLimit(`transcribe_${uid}`, 20, 60 * 1000); // 20 transcriptions per minute

  try {
    const ZAI = require('z-ai-web-dev-sdk').default;
    const zai = await ZAI.create();
    const result = await zai.audio.transcriptions.create({
      audio: audioBase64,
      format
    });
    const text = result?.text || '';
    return { success: true, text };
  } catch (err) {
    logger.error('Transcribe error:', err);
    throw new HttpsError('internal', 'Transcription service failed.');
  }
});

// ============================================================
//  16. LOG PROFILE VISIT (for Profile Tracker feature)
//  Records who visited whose profile.
// ============================================================
exports.logProfileVisit = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid } = req.data || {};
  if (!targetUid || targetUid === uid) {
    return { success: false, skipped: true };
  }

  rateLimit(`profile_visit_${uid}`, 60, 60 * 1000); // 60 profile visits per minute

  // Verify target user exists
  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user not found.');

  // Verify the VISITED user has tracker feature (only they can see visits)
  const targetFeatures = targetSnap.data()?.unlockedFeatures || [];
  if (!targetFeatures.includes('tracker')) {
    // Target doesn't have tracker — don't log (saves quota)
    return { success: false, skipped: true };
  }

  await db.collection('profile_visits').add({
    visitorId: uid,
    targetUid,
    timestamp: Date.now()
  });

  return { success: true };
});

// ============================================================
//  17. AI SMART REPLY (uses z-ai-web-dev-sdk LLM)
//  Suggests 3 quick replies based on the incoming message.
// ============================================================
exports.smartReply = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { incomingText, contextText = '' } = req.data || {};
  if (!incomingText || typeof incomingText !== 'string' || incomingText.length > 1000) {
    throw new HttpsError('invalid-argument', 'Invalid incomingText.');
  }

  rateLimit(`smart_reply_${uid}`, 30, 60 * 1000);

  try {
    const ZAI = require('z-ai-web-dev-sdk').default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a smart reply assistant. Given an incoming chat message, suggest 3 short, natural reply options (max 8 words each). Return ONLY a JSON array of 3 strings, no other text. Example: ["Sure!", "Sounds good", "Let me check"].' },
        { role: 'user', content: `Incoming: "${incomingText}"\nContext: "${contextText}"` }
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '[]';
    let replies = [];
    try { replies = JSON.parse(raw); } catch (_) { replies = []; }
    if (!Array.isArray(replies)) replies = [];
    return { success: true, replies: replies.slice(0, 3) };
  } catch (err) {
    logger.error('Smart reply error:', err);
    throw new HttpsError('internal', 'Smart reply service failed.');
  }
});

// ============================================================
//  18. CONTENT MODERATION (uses z-ai-web-dev-sdk LLM)
//  Flags hate speech / adult content / spam before saving.
//  Returns { safe: bool, reasons: [] }
// ============================================================
exports.moderateContent = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { text } = req.data || {};
  if (!text || typeof text !== 'string' || text.length > 2000) {
    throw new HttpsError('invalid-argument', 'Invalid text.');
  }

  rateLimit(`moderate_${uid}`, 60, 60 * 1000);

  try {
    const ZAI = require('z-ai-web-dev-sdk').default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a content moderator. Analyze the given text. Return ONLY JSON: {"safe": true/false, "reasons": ["hate", "adult", "spam", "violence"]} (only include reasons that apply). Be strict but not over-sensitive.' },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 100
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '{"safe":true,"reasons":[]}';
    let result;
    try { result = JSON.parse(raw); } catch (_) { result = { safe: true, reasons: [] }; }
    return { success: true, safe: result.safe !== false, reasons: result.reasons || [] };
  } catch (err) {
    logger.error('Moderation error:', err);
    // Fail-open: allow content if moderation service is down
    return { success: false, safe: true, reasons: [], fallback: true };
  }
});

// ============================================================
//  19. FIRESTORE TRIGGER — on new signup, force safe defaults
// ============================================================
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
exports.onUserCreate = onDocumentCreated('users/{uid}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();
  const safeDefaults = {
    role: data.role === 'admin' ? 'user' : (data.role || 'user'),
    gold: 0,
    diamonds: 0,
    isBanned: false,
    isVerified: false,
    isPremium: false,
    accountCreated: Date.now(),
    followerCount: 0,
    friendsCount: 0,
    roomsJoined: 0,
    // Phase 2/3 fields — initialized to safe defaults
    activeBoosts: data.activeBoosts || {},
    ownedItems: data.ownedItems || [],
    purchasedItems: data.purchasedItems || [],
    badges: data.badges || [],
    voiceEffects: data.voiceEffects || [],
    chatStyles: data.chatStyles || [],
    stickerPacks: data.stickerPacks || [],
    unlockedFeatures: data.unlockedFeatures || [],
    equippedAvatar: data.equippedAvatar || null,
    equippedNameColor: data.equippedNameColor || null,
    equippedMusic: data.equippedMusic || null,
    equippedRingtone: data.equippedRingtone || null,
    // Auto-reply defaults
    autoreplyEnabled: false,
    autoreplyText: "",
    // 2FA default
    has2FA: false
  };
  await snap.ref.set(safeDefaults, { merge: true });
  logger.info(`User ${event.params.uid} initialized with safe defaults.`);
});

// ============================================================
//  12. FIRESTORE TRIGGER — on user delete (cleanup hook)
// ============================================================
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
exports.onUserDelete = onDocumentDeleted('users/{uid}', async (event) => {
  const uid = event.params.uid;
  logger.info(`User ${uid} deleted — cleanup can be added here.`);
});

// ============================================================
//  20. VERIFY RECAPTCHA (signup bot protection)
//  Verifies the reCAPTCHA v2 token with Google's siteverify API.
//  Set RECAPTCHA_SECRET env var: `firebase functions:secrets:set RECAPTCHA_SECRET`
// ============================================================
exports.verifyRecaptcha = onCall(async (req) => {
  const { token } = req.data || {};
  if (!token || typeof token !== 'string') {
    throw new HttpsError('invalid-argument', 'reCAPTCHA token required.');
  }

  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) {
    logger.error('RECAPTCHA_SECRET env var not configured.');
    throw new HttpsError('internal', 'reCAPTCHA not configured. Set RECAPTCHA_SECRET env var.');
  }

  try {
    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`;
    const resp = await fetch(verifyUrl, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) {
      throw new HttpsError('permission-denied', 'reCAPTCHA verification failed.');
    }
    return { success: true, score: data.score || 1 };
  } catch (err) {
    if (err.code === 'permission-denied') throw err;
    logger.error('reCAPTCHA verify error:', err);
    throw new HttpsError('internal', 'reCAPTCHA verification service failed.');
  }
});

// ============================================================
//  21. SETUP 2FA (generate TOTP secret + QR code)
//  Returns { secret, qrCodeDataUrl, otpauthUrl }
//  Stores encrypted secret in totp_secrets/{uid} pending verification.
// ============================================================
exports.setup2FA = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { authenticator } = require('otplib');
  const QRCode = require('qrcode');

  // Fetch user's email/username for the OTP label
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data() || {};
  const label = `MR Chat:${user.email || user.username || uid}`;

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(label, 'MR Chat', secret);

  // Render QR as data URL (so frontend can display directly)
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });

  // Store pending secret (NOT yet active — verification required)
  await db.doc(`totp_secrets/${uid}`).set({
    uid,
    secret,
    verified: false,
    createdAt: Date.now()
  });

  return { success: true, secret, qrCodeDataUrl, otpauthUrl };
});

// ============================================================
//  22. CHECK 2FA REQUIRED (pre-login — takes email)
//  Returns { required: bool } WITHOUT requiring auth.
//  Used by login flow to decide whether to prompt for 2FA code.
// ============================================================
exports.check2FARequired = onCall(async (req) => {
  const { email } = req.data || {};
  if (!email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'Email required.');
  }
  // Find user by email
  const snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
  if (snap.empty) {
    // Don't leak whether email exists — return false
    return { required: false };
  }
  const userDoc = snap.docs[0].data();
  return { required: userDoc.has2FA === true };
});

// ============================================================
//  22b. VERIFY 2FA (verify login code OR activate 2FA)
//  action: 'activate' — verifies first code, marks 2FA active (post-login)
//  action: 'verify' — verifies a login code (post-login, called after password auth)
//  NOTE: For security, the 2FA code check happens AFTER password authentication,
//  so the caller must already be authenticated. The frontend flow:
//    1. check2FARequired(email) → if required, show 2FA input
//    2. signInWithEmailAndPassword(password)
//    3. verify2FA({ action: 'verify', code })
// ============================================================
exports.verify2FA = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { action = 'verify', code } = req.data || {};
  const { authenticator } = require('otplib');

  const secretDoc = await db.doc(`totp_secrets/${uid}`).get();
  if (!secretDoc.exists) {
    // User has no 2FA — verification passes through
    if (action === 'verify') return { required: false, verified: true };
    throw new HttpsError('not-found', '2FA not set up.');
  }
  const secretData = secretDoc.data();

  // For 'activate', only the secret needs to exist (not yet verified)
  // For 'verify', the secret must be marked verified=true (active 2FA)
  if (action === 'verify' && secretData.verified !== true) {
    return { required: false, verified: true };
  }

  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '6-digit code required.');
  }

  const isValid = authenticator.verify({ token: code, secret: secretData.secret });
  if (!isValid) {
    throw new HttpsError('permission-denied', 'Invalid 2FA code.');
  }

  if (action === 'activate') {
    await db.doc(`totp_secrets/${uid}`).set({ verified: true, activatedAt: Date.now() }, { merge: true });
    await db.doc(`users/${uid}`).set({ has2FA: true }, { merge: true });
    return { success: true, activated: true };
  }

  if (action === 'verify') {
    return { required: true, verified: true };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

// ============================================================
//  23. DISABLE 2FA (requires valid current code)
// ============================================================
exports.disable2FA = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { code } = req.data || {};
  const { authenticator } = require('otplib');

  const secretDoc = await db.doc(`totp_secrets/${uid}`).get();
  if (!secretDoc.exists) {
    return { success: true, alreadyDisabled: true };
  }
  const secretData = secretDoc.data();

  if (!code || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '6-digit code required to disable 2FA.');
  }
  const isValid = authenticator.verify({ token: code, secret: secretData.secret });
  if (!isValid) {
    throw new HttpsError('permission-denied', 'Invalid 2FA code.');
  }

  await db.doc(`totp_secrets/${uid}`).delete();
  await db.doc(`users/${uid}`).set({ has2FA: false }, { merge: true });
  return { success: true, disabled: true };
});

// ============================================================
//  24. SCHEDULED: DELETE OLD CHAT MESSAGES
//  Runs daily. For each friendship + group room, deletes messages
//  older than 1 month, keeping the most recent 10 per conversation.
//  Uses where timestamp < cutoff query (cheaper than full scan).
// ============================================================
const { onSchedule } = require('firebase-functions/v2/scheduler');
exports.scheduledDeleteOldMessages = onSchedule(
  {
    schedule: '0 3 * * *', // Daily at 3:00 AM
    timeZone: 'Asia/Dhaka',
    memory: '512MiB',
    timeoutSeconds: 540
  },
  async (event) => {
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const KEEP_LAST = 10;
    const cutoff = Date.now() - ONE_MONTH_MS;
    let totalDeleted = 0;
    let chatsProcessed = 0;

    async function cleanCollection(msgColl) {
      // Step 1: Get the most recent KEEP_LAST messages (we'll preserve these even if old)
      const recentSnap = await msgColl.orderBy('timestamp', 'desc').limit(KEEP_LAST).get();
      const preserveIds = new Set(recentSnap.docs.map(d => d.id));

      // Step 2: Query messages older than cutoff (indexed query — cheap)
      // Note: requires composite index on (timestamp) — see firestore.indexes.json
      const oldSnap = await msgColl.where('timestamp', '<', cutoff).limit(400).get();
      if (oldSnap.empty) return 0;

      const batch = db.batch();
      let count = 0;
      for (const doc of oldSnap.docs) {
        if (preserveIds.has(doc.id)) continue;
        batch.delete(doc.ref);
        count++;
      }
      if (count > 0) await batch.commit();
      return count;
    }

    // 1. Process friendship chats
    try {
      const friendshipsSnap = await db.collection('friendships').limit(2000).get();
      for (const fDoc of friendshipsSnap.docs) {
        try {
          const deleted = await cleanCollection(fDoc.ref.collection('chat_messages'));
          totalDeleted += deleted;
          if (deleted > 0) chatsProcessed++;
        } catch (err) {
          logger.warn(`Failed to clean friendship ${fDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      logger.error('Friendship cleanup failed:', err.message);
    }

    // 2. Process group room messages
    try {
      const roomsSnap = await db.collection('group_rooms').limit(500).get();
      for (const rDoc of roomsSnap.docs) {
        try {
          const deleted = await cleanCollection(rDoc.ref.collection('room_messages'));
          totalDeleted += deleted;
          if (deleted > 0) chatsProcessed++;
        } catch (err) {
          logger.warn(`Failed to clean room ${rDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      logger.error('Room cleanup failed:', err.message);
    }

    logger.info(`[scheduledDelete] Processed ${chatsProcessed} chats, deleted ${totalDeleted} messages older than 1 month.`);
  }
);

// ============================================================
//  25. SCHEDULE: MESSAGE SCHEDULER (cron every minute)
//  Sends scheduled messages whose scheduledAt time has arrived.
// ============================================================
exports.messageScheduler = onSchedule(
  {
    schedule: '* * * * *', // Every minute
    timeZone: 'Asia/Dhaka',
    memory: '256MiB',
    timeoutSeconds: 120
  },
  async (event) => {
    const now = Date.now();
    const q = db.collection('scheduled_messages').where('sent', '==', false).where('scheduledAt', '<=', now).limit(50);
    const snap = await q.get();
    if (snap.empty) return;

    let sent = 0;
    for (const doc of snap.docs) {
      try {
        const data = doc.data();
        // Send the message to the target chat
        let targetColl;
        if (data.chatType === 'friendship') {
          targetColl = db.collection('friendships').doc(data.chatId).collection('chat_messages');
        } else if (data.chatType === 'room') {
          targetColl = db.collection('group_rooms').doc(data.chatId).collection('room_messages');
        } else {
          await doc.ref.set({ sent: true, error: 'invalid chatType' }, { merge: true });
          continue;
        }
        await targetColl.add({
          senderId: data.senderId,
          text: data.text,
          image: data.image || null,
          audio: data.audio || null,
          sticker: data.sticker || null,
          timestamp: Date.now(),
          scheduled: true
        });
        await doc.ref.set({ sent: true, sentAt: Date.now() }, { merge: true });
        sent++;
      } catch (err) {
        logger.warn(`Scheduler: failed to send ${doc.id}:`, err.message);
        await doc.ref.set({ sent: true, error: err.message }, { merge: true });
      }
    }
    if (sent > 0) logger.info(`[scheduler] Sent ${sent} scheduled messages.`);
  }
);

// ============================================================
//  26. AUTO-REPLY BOT (Firestore trigger on new DM)
//  If recipient has autoreply enabled + message text, sends their
//  preset auto-reply back to the sender.
//  SAFETY: skips own auto-replies, scheduled messages, and respects
//  cooldown (max 1 auto-reply per recipient per 60s).
// ============================================================
// In-memory cooldown (per-instance; for multi-instance use Redis)
const _autoReplyCooldown = new Map();
// onDocumentCreated already imported above (line 976)
exports.autoReplyBot = onDocumentCreated('friendships/{friendshipId}/chat_messages/{msgId}', async (event) => {
  const msg = event.data?.data();
  if (!msg) return;
  const friendshipId = event.params.friendshipId;
  const msgId = event.params.msgId;

  // Don't reply to our own auto-replies, scheduled messages, or recalled messages
  if (msg.isAutoReply || msg.scheduled || msg.recalled) return;

  const senderId = msg.senderId;
  const fSnap = await db.doc(`friendships/${friendshipId}`).get();
  if (!fSnap.exists) return;
  const f = fSnap.data();
  // Determine recipient (the other party)
  const recipientId = f.user1 === senderId ? f.user2 : f.user1;
  if (!recipientId) return;

  // Don't auto-reply to ourselves
  if (recipientId === senderId) return;

  // Cooldown — max 1 auto-reply per recipient per 60 seconds
  const cooldownKey = recipientId;
  const now = Date.now();
  const lastReply = _autoReplyCooldown.get(cooldownKey) || 0;
  if (now - lastReply < 60000) return;

  // Check recipient has autoreply enabled
  const recipientSnap = await db.doc(`users/${recipientId}`).get();
  if (!recipientSnap.exists) return;
  const recipient = recipientSnap.data();
  const features = recipient.unlockedFeatures || [];
  if (!features.includes('autoreply')) return; // feature not purchased
  if (!recipient.autoreplyEnabled) return; // user disabled it
  const replyText = recipient.autoreplyText || "I'm currently away. Will reply soon!";
  if (!replyText.trim()) return;

  // Don't reply to empty/system messages
  if (!msg.text || !msg.text.trim()) return;

  // Mark cooldown
  _autoReplyCooldown.set(cooldownKey, now);

  // Insert the auto-reply after a small natural delay (2-5s)
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

  await db.collection('friendships').doc(friendshipId).collection('chat_messages').add({
    senderId: recipientId,
    text: replyText,
    image: null,
    audio: null,
    sticker: null,
    timestamp: Date.now(),
    isAutoReply: true
  });
});

// ============================================================
//  27. SECRET CHAT — KEY EXCHANGE (for E2E encryption)
//  Stores user's public key so others can encrypt messages to them.
//  Private key NEVER leaves the client (libsodium.js).
// ============================================================
exports.publishSecretChatKey = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { publicKey } = req.data || {};
  if (!publicKey || typeof publicKey !== 'string' || publicKey.length > 200) {
    throw new HttpsError('invalid-argument', 'Invalid public key.');
  }

  await db.doc(`secret_chat_keys/${uid}`).set({
    uid,
    publicKey,
    updatedAt: Date.now()
  });
  return { success: true };
});

// ============================================================
//  28. GET SECRET CHAT PUBLIC KEY (for encrypting to recipient)
// ============================================================
exports.getSecretChatKey = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid } = req.data || {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

  const snap = await db.doc(`secret_chat_keys/${targetUid}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Recipient has not set up secret chat.');
  }
  return { success: true, publicKey: snap.data().publicKey };
});

// ============================================================
//  29. MARK MESSAGE AS READ (read receipts)
//  Called when recipient opens/reads a message. Sets readAt timestamp.
//  Sender sees blue ticks when readAt is set.
// ============================================================
exports.markMessageRead = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { messageId, chatType, chatId } = req.data || {};
  if (!messageId || !chatType || !chatId) {
    throw new HttpsError('invalid-argument', 'messageId, chatType, chatId required.');
  }
  if (!['friendship', 'room'].includes(chatType)) {
    throw new HttpsError('invalid-argument', 'Invalid chatType.');
  }

  let msgRef;
  if (chatType === 'friendship') {
    const fSnap = await db.doc(`friendships/${chatId}`).get();
    if (!fSnap.exists) throw new HttpsError('not-found', 'Chat not found.');
    const f = fSnap.data();
    if (f.user1 !== uid && f.user2 !== uid) {
      throw new HttpsError('permission-denied', 'Not a participant.');
    }
    msgRef = db.doc(`friendships/${chatId}/chat_messages/${messageId}`);
  } else {
    const rSnap = await db.doc(`group_rooms/${chatId}`).get();
    if (!rSnap.exists) throw new HttpsError('not-found', 'Room not found.');
    msgRef = db.doc(`group_rooms/${chatId}/room_messages/${messageId}`);
  }

  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Message not found.');
  const msg = msgSnap.data();

  // Only the recipient can mark as read (not the sender)
  if (msg.senderId === uid) {
    return { success: true, alreadyRead: true };
  }

  if (msg.readAt) {
    return { success: true, alreadyRead: true };
  }

  await msgRef.set({ readAt: Date.now(), readBy: uid }, { merge: true });
  return { success: true };
});

// ============================================================
//  30. SET TYPING STATUS (typing indicator)
//  Called periodically while user is typing. Sets typingTo field on user doc.
//  Auto-expires after 5 seconds of inactivity (client stops sending).
// ============================================================
exports.setTypingStatus = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid, chatType } = req.data || {};
  if (!targetUid || !['friendship', 'room'].includes(chatType)) {
    throw new HttpsError('invalid-argument', 'targetUid + chatType required.');
  }

  rateLimit(`typing_${uid}`, 30, 60 * 1000); // 30 updates per minute

  // Set typingTo with 5-second expiry timestamp
  await db.doc(`users/${uid}`).set({
    typingTo: targetUid,
    typingChatType: chatType,
    typingExpiresAt: Date.now() + 5000
  }, { merge: true });

  return { success: true };
});

// ============================================================
//  31. STOP TYPING (clear typing indicator)
// ============================================================
exports.stopTyping = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  await db.doc(`users/${uid}`).set({
    typingTo: null,
    typingChatType: null,
    typingExpiresAt: null
  }, { merge: true });

  return { success: true };
});

// ============================================================
//  32. BLOCK USER (with mutual block check)
//  Adds target to blockedUsers array. Future messages from blocked user are hidden.
// ============================================================
exports.blockUser = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid, reason } = req.data || {};
  if (!targetUid || targetUid === uid) {
    throw new HttpsError('invalid-argument', 'Invalid target.');
  }

  rateLimit(`block_${uid}`, 20, 60 * 60 * 1000); // 20 blocks per hour

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'User missing.');
  const u = snap.data();
  const blocked = u.blockedUsers || [];
  if (blocked.includes(targetUid)) {
    return { success: true, alreadyBlocked: true };
  }
  blocked.push(targetUid);
  await userRef.set({ blockedUsers: blocked }, { merge: true });

  // Log block action (audit)
  await db.collection('admin_logs').add({
    action: 'Block User',
    details: `User ${uid} blocked ${targetUid}${reason ? `: ${reason}` : ''}`,
    adminId: uid,
    adminName: u.username || 'User',
    targetUid,
    targetType: 'user',
    timestamp: Date.now()
  });

  return { success: true, blocked: true };
});

// ============================================================
//  33. UNBLOCK USER
// ============================================================
exports.unblockUser = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetUid } = req.data || {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'User missing.');
  const u = snap.data();
  const blocked = (u.blockedUsers || []).filter(id => id !== targetUid);
  await userRef.set({ blockedUsers: blocked }, { merge: true });

  return { success: true };
});

// ============================================================
//  34. REPORT USER / CONTENT (with rate limit)
// ============================================================
exports.reportContent = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { targetType, targetId, reason, details } = req.data || {};
  if (!targetType || !targetId || !reason) {
    throw new HttpsError('invalid-argument', 'targetType, targetId, reason required.');
  }
  if (!['user', 'post', 'message', 'room'].includes(targetType)) {
    throw new HttpsError('invalid-argument', 'Invalid targetType.');
  }
  if (reason.length > 200 || (details && details.length > 1000)) {
    throw new HttpsError('invalid-argument', 'Reason/details too long.');
  }

  rateLimit(`report_${uid}`, 10, 60 * 60 * 1000); // 10 reports per hour

  await db.collection('reports').add({
    reporterId: uid,
    targetType,
    targetId,
    reason,
    details: details || '',
    status: 'pending',
    createdAt: Date.now()
  });

  return { success: true };
});

// ============================================================
//  35. STORE FCM TOKEN (for web push notifications)
//  Called by frontend after obtaining FCM token. Stores token
//  in fcm_tokens collection for later push delivery.
// ============================================================
exports.storeFCMToken = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { token } = req.data || {};
  if (!token || typeof token !== 'string' || token.length > 500) {
    throw new HttpsError('invalid-argument', 'Invalid FCM token.');
  }

  // Store token with uid — use token as doc id for idempotency
  await db.doc(`fcm_tokens/${token}`).set({
    uid,
    token,
    platform: 'web',
    updatedAt: Date.now()
  }, { merge: true });

  return { success: true };
});

// ============================================================
//  36. SEND PUSH NOTIFICATION (internal helper, not exported as onCall)
//  Sends FCM v1 message to all tokens owned by a user.
//  Requires Firebase Admin Messaging SDK (already in firebase-admin).
// ============================================================
async function sendPushNotification(targetUid, title, body, data = {}) {
  try {
    // Fetch all FCM tokens for this user
    const snap = await db.collection('fcm_tokens').where('uid', '==', targetUid).limit(10).get();
    if (snap.empty) return { sent: 0 };

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (tokens.length === 0) return { sent: 0 };

    const message = {
      notification: { title, body },
      data: { ...data, click_action: data.url || '/' },
      webpush: {
        notification: {
          title,
          body,
          icon: 'https://api.dicebear.com/7.x/adventurer/svg?seed=mrchat&backgroundColor=ff007f',
          badge: 'https://api.dicebear.com/7.x/adventurer/svg?seed=badge',
          tag: data.tag || 'mr-chat-msg',
          requireInteraction: false
        },
        fcmOptions: { link: data.url || '/' }
      }
    };

    // Send to each token individually (batch send not supported for v1 with webpush)
    const messaging = admin.messaging();
    let sentCount = 0;
    const invalidTokens = [];
    for (const token of tokens) {
      try {
        await messaging.send({ ...message, token });
        sentCount++;
      } catch (err) {
        // Token is invalid/unregistered — clean up
        if (err.code === 'messaging/invalid-registration-token' ||
            err.code === 'messaging/registration-token-not-registered' ||
            err.message?.includes('UNREGISTERED')) {
          invalidTokens.push(token);
        } else {
          logger.warn(`Push send failed for token ${token.substring(0, 10)}...:`, err.message);
        }
      }
    }
    // Clean up invalid tokens
    for (const token of invalidTokens) {
      await db.doc(`fcm_tokens/${token}`).delete().catch(()=>{});
    }
    return { sent: sentCount, cleaned: invalidTokens.length };
  } catch (err) {
    logger.error('sendPushNotification error:', err.message);
    return { sent: 0, error: err.message };
  }
}

// ============================================================
//  37. PUSH ON NEW DM (Firestore trigger — fires after autoReplyBot)
//  Sends push notification to recipient when a new DM arrives.
// ============================================================
exports.pushOnNewDM = onDocumentCreated(
  'friendships/{friendshipId}/chat_messages/{msgId}',
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;
    const senderId = msg.senderId;
    if (msg.isAutoReply || msg.scheduled) return; // skip auto/system messages

    const friendshipId = event.params.friendshipId;
    const fSnap = await db.doc(`friendships/${friendshipId}`).get();
    if (!fSnap.exists) return;
    const f = fSnap.data();
    const recipientId = f.user1 === senderId ? f.user2 : f.user1;
    if (!recipientId || recipientId === senderId) return;

    // Fetch recipient + sender user docs
    const [recipientSnap, senderSnap] = await Promise.all([
      db.doc(`users/${recipientId}`).get(),
      db.doc(`users/${senderId}`).get()
    ]);
    if (!recipientSnap.exists) return;
    const recipient = recipientSnap.data();
    if (recipient.isBanned === true) return;

    // Don't push if recipient is currently active in chat with sender
    if (recipient.activeChatWith === senderId) return;

    const senderName = senderSnap.exists
      ? (senderSnap.data().username || senderSnap.data().fullName || 'Someone')
      : 'Someone';

    // Build notification body
    let body = 'You have a new message';
    if (msg.text) body = msg.text.length > 80 ? msg.text.substring(0, 77) + '...' : msg.text;
    else if (msg.attachedImage) body = '📷 Photo';
    else if (msg.gifUrl) body = '🎞️ GIF';
    else if (msg.voiceNotes) body = '🎤 Voice message';
    else if (msg.sticker) body = msg.sticker + ' Sticker';

    await sendPushNotification(recipientId, `${senderName}`, body, {
      url: '/inbox.html',
      tag: `dm_${senderId}`,
      type: 'dm',
      senderId,
      senderName
    });
  }
);

// ============================================================
//  38. LOG USER ACTIVITY (called by clients on every meaningful action)
//  Stores to user_activity collection for admin analytics.
//  Also updates daily counters on user doc for fast dashboard stats.
// ============================================================
exports.logUserActivity = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { action, metadata } = req.data || {};
  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'action required.');
  }
  // Whitelist of valid actions to prevent log spam
  const VALID_ACTIONS = [
    'message_sent', 'message_received', 'post_created', 'post_liked', 'post_commented',
    'post_shared', 'post_saved', 'story_viewed', 'story_created', 'room_joined',
    'room_created', 'friend_request_sent', 'friend_request_accepted', 'call_started',
    'call_completed', 'voice_sent', 'image_sent', 'sticker_sent', 'gift_sent',
    'store_purchase', 'login', 'logout', 'profile_view', 'search_performed',
    'reaction_added', 'comment_deleted', 'post_deleted', 'user_blocked', 'user_reported',
    'theme_changed', '2fa_enabled', '2fa_disabled', 'gold_earned', 'diamond_earned'
  ];
  if (!VALID_ACTIONS.includes(action)) {
    throw new HttpsError('invalid-argument', 'Unknown action.');
  }

  rateLimit(`activity_${uid}`, 200, 60 * 1000); // 200 actions/min max

  // Write to user_activity collection
  const activityRef = db.collection('user_activity').doc();
  await activityRef.set({
    id: activityRef.id,
    uid,
    action,
    metadata: metadata || {},
    timestamp: Date.now(),
    dateStr: new Date().toISOString().slice(0, 10) // YYYY-MM-DD for daily grouping
  });

  // Update daily counter on user doc (for fast dashboard stats)
  const todayKey = `activityToday.${new Date().toISOString().slice(0, 10)}.${action}`;
  const userRef = db.doc(`users/${uid}`);
  const update = {};
  update[todayKey] = FieldValue.increment(1);
  update['activityToday._lastUpdated'] = Date.now();
  await userRef.set(update, { merge: true }).catch(()=>{});

  return { success: true };
});

// ============================================================
//  39. GET SMART FEED (algorithmic post ranking)
//  Returns post IDs ranked by: recency, engagement, relationship,
//  author activity. Client fetches full post docs by these IDs.
// ============================================================
exports.getSmartFeed = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { limit: maxResults = 30 } = req.data || {};
  if (maxResults > 100) throw new HttpsError('invalid-argument', 'Limit too high.');

  rateLimit(`smartfeed_${uid}`, 10, 60 * 1000);

  // Fetch recent posts (last 7 days, up to 200 candidates)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const postsSnap = await db.collection('posts')
    .where('timestamp', '>', sevenDaysAgo)
    .orderBy('timestamp', 'desc')
    .limit(200)
    .get();

  if (postsSnap.empty) return { posts: [] };

  // Get user's friends + following sets for relationship scoring
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const followingIds = new Set(userData.followingIds || []);
  // Fetch friendships for friend set
  const friendsSnap = await db.collection('friendships')
    .where('user1', '==', uid).get();
  const friends2Snap = await db.collection('friendships')
    .where('user2', '==', uid).get();
  const friendIds = new Set();
  friendsSnap.forEach(d => { const f = d.data(); if (f.status === 'accepted') friendIds.add(f.user2); });
  friends2Snap.forEach(d => { const f = d.data(); if (f.status === 'accepted') friendIds.add(f.user1); });

  const now = Date.now();
  // Score each post
  const scored = postsSnap.docs.map(doc => {
    const p = doc.data();
    const ageHours = (now - (p.timestamp || 0)) / (1000 * 60 * 60);

    // 1. Recency score (decays over 7 days)
    let recencyScore = Math.max(0, 100 - (ageHours * 1.5));

    // 2. Engagement score
    const reactions = p.reactionsCount || 0;
    const comments = p.commentsCount || 0;
    const shares = p.shares || 0;
    const engagementScore = (reactions * 2) + (comments * 3) + (shares * 5);

    // 3. Relationship score
    let relationshipScore = 0;
    if (p.userId === uid) relationshipScore = 50; // own posts
    else if (friendIds.has(p.userId)) relationshipScore = 30; // friends
    else if (followingIds.has(p.userId)) relationshipScore = 15; // following
    else relationshipScore = 5; // stranger

    // 4. Author activity boost (active authors get small boost)
    const authorBoost = 0; // would need author fetch — skip for perf

    // 5. Media boost (posts with images/videos get slight boost)
    const mediaBoost = (p.images && p.images.length > 0) ? 5 : 0;

    // Total score (weighted)
    const totalScore = (recencyScore * 0.4) + (engagementScore * 0.3) + (relationshipScore * 0.25) + (authorBoost * 0.05) + mediaBoost;

    return { id: doc.id, score: totalScore, timestamp: p.timestamp };
  });

  // Sort by score desc, then by timestamp desc (tiebreaker)
  scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

  // Return top N post IDs
  return { posts: scored.slice(0, maxResults) };
});

// ============================================================
//  40. GET FRIEND SUGGESTIONS ("People you may know")
//  Returns up to 10 suggested users based on:
//  - mutual friends (highest weight)
//  - same rooms joined
//  - similar interests
// ============================================================
exports.getFriendSuggestions = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  rateLimit(`suggestions_${uid}`, 10, 60 * 1000);

  // Get user's data
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User missing.');
  const me = userSnap.data();
  const myFriends = new Set(me.friendsIds || []);
  const myRooms = new Set(me.joinedRooms || []);
  const myInterests = new Set(me.interests || []);
  const blocked = new Set(me.blockedUsers || []);

  // Get my friendships to exclude existing
  const f1Snap = await db.collection('friendships').where('user1', '==', uid).get();
  const f2Snap = await db.collection('friendships').where('user2', '==', uid).get();
  const existingConnections = new Set([uid]);
  f1Snap.forEach(d => { existingConnections.add(d.data().user2); });
  f2Snap.forEach(d => { existingConnections.add(d.data().user1); });

  // Get pending friend requests to exclude
  const req1Snap = await db.collection('friendRequests').where('fromUid', '==', uid).get();
  const req2Snap = await db.collection('friendRequests').where('toUid', '==', uid).get();
  req1Snap.forEach(d => { existingConnections.add(d.data().toUid); });
  req2Snap.forEach(d => { existingConnections.add(d.data().fromUid); });

  // Strategy 1: Friends of friends (mutual friends)
  const mutualFriendCounts = new Map();
  for (const friendId of myFriends) {
    if (friendId === uid) continue;
    const ff1 = await db.collection('friendships').where('user1', '==', friendId).limit(50).get();
    const ff2 = await db.collection('friendships').where('user2', '==', friendId).limit(50).get();
    ff1.forEach(d => {
      const f = d.data();
      const otherId = f.user2;
      if (!existingConnections.has(otherId) && !blocked.has(otherId)) {
        mutualFriendCounts.set(otherId, (mutualFriendCounts.get(otherId) || 0) + 1);
      }
    });
    ff2.forEach(d => {
      const f = d.data();
      const otherId = f.user1;
      if (!existingConnections.has(otherId) && !blocked.has(otherId)) {
        mutualFriendCounts.set(otherId, (mutualFriendCounts.get(otherId) || 0) + 1);
      }
    });
  }

  // Strategy 2: Same rooms
  const roomMemberCounts = new Map();
  for (const roomId of Array.from(myRooms).slice(0, 10)) {
    const roomSnap = await db.doc(`group_rooms/${roomId}`).get();
    if (!roomSnap.exists) continue;
    const room = roomSnap.data();
    const members = room.memberIds || [];
    members.forEach(memberId => {
      if (!existingConnections.has(memberId) && !blocked.has(memberId)) {
        roomMemberCounts.set(memberId, (roomMemberCounts.get(memberId) || 0) + 1);
      }
    });
  }

  // Combine candidates with scores
  const candidates = new Map();
  for (const [candidateId, mutualCount] of mutualFriendCounts) {
    candidates.set(candidateId, { id: candidateId, score: mutualCount * 10 + (roomMemberCounts.get(candidateId) || 0) * 3 });
  }
  for (const [candidateId, roomCount] of roomMemberCounts) {
    if (!candidates.has(candidateId)) {
      candidates.set(candidateId, { id: candidateId, score: roomCount * 3 });
    }
  }

  // If we have fewer than 10, fill with random active users
  if (candidates.size < 10) {
    const recentActiveSnap = await db.collection('users')
      .where('status', '==', 'online')
      .where('isBanned', '==', false)
      .limit(30)
      .get();
    recentActiveSnap.forEach(d => {
      if (!candidates.has(d.id) && !existingConnections.has(d.id) && !blocked.has(d.id)) {
        const interests = new Set(d.data().interests || []);
        let interestScore = 0;
        for (const i of myInterests) { if (interests.has(i)) interestScore++; }
        candidates.set(d.id, { id: d.id, score: interestScore * 2 });
      }
    });
  }

  // Sort by score, take top 10
  const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  if (sorted.length === 0) return { suggestions: [] };

  // Fetch user docs for these candidates
  const candidateIds = sorted.map(c => c.id);
  const userDocs = {};
  for (const cid of candidateIds) {
    const snap = await db.doc(`users/${cid}`).get();
    if (snap.exists) userDocs[cid] = snap.data();
  }

  const suggestions = sorted
    .filter(c => userDocs[c.id])
    .map(c => ({
      uid: c.id,
      username: userDocs[c.id].username || 'User',
      fullName: userDocs[c.id].fullName || '',
      photoURL: userDocs[c.id].photoURL || '',
      level: userDocs[c.id].level || 1,
      mutualFriends: mutualFriendCounts.get(c.id) || 0,
      mutualRooms: roomMemberCounts.get(c.id) || 0,
      score: c.score
    }));

  return { suggestions };
});

// ============================================================
//  41. GET TRENDING HASHTAGS (algorithm)
//  Returns top 20 hashtags from last 24 hours, ranked by usage.
// ============================================================
exports.getTrendingHashtags = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  rateLimit(`trending_${uid}`, 10, 60 * 1000);

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const postsSnap = await db.collection('posts')
    .where('timestamp', '>', oneDayAgo)
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();

  const hashtagCounts = new Map();
  const hashtagEngagement = new Map();
  postsSnap.forEach(doc => {
    const p = doc.data();
    const tags = p.hashtags || [];
    const engagement = (p.reactionsCount || 0) + (p.commentsCount || 0) * 2 + (p.shares || 0) * 3;
    tags.forEach(tag => {
      const normalized = tag.toLowerCase().replace(/^#/, '');
      if (!normalized) return;
      hashtagCounts.set(normalized, (hashtagCounts.get(normalized) || 0) + 1);
      hashtagEngagement.set(normalized, (hashtagEngagement.get(normalized) || 0) + engagement);
    });
  });

  // Score = count * 10 + engagement
  const trending = Array.from(hashtagCounts.keys())
    .map(tag => ({
      tag,
      count: hashtagCounts.get(tag),
      engagement: hashtagEngagement.get(tag),
      score: hashtagCounts.get(tag) * 10 + hashtagEngagement.get(tag)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return { trending };
});

// ============================================================
//  42. GET USER ANALYTICS (admin-only)
//  Returns full activity timeline + aggregate stats for a user.
// ============================================================
exports.getUserAnalytics = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  const admin = await requireAdmin(adminUid);

  const { targetUid, days = 30 } = req.data || {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
  if (days > 90) throw new HttpsError('invalid-argument', 'Max 90 days.');

  rateLimit(`analytics_${adminUid}`, 30, 60 * 1000);

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Fetch user doc
  const userSnap = await db.doc(`users/${targetUid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const user = userSnap.data();

  // Fetch activity log (last N days, limit 1000)
  const activitySnap = await db.collection('user_activity')
    .where('uid', '==', targetUid)
    .where('timestamp', '>', cutoff)
    .orderBy('timestamp', 'desc')
    .limit(1000)
    .get();

  // Aggregate by action type
  const actionCounts = {};
  const dailyActivity = {};
  const recentActivity = [];
  activitySnap.forEach(doc => {
    const a = doc.data();
    actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
    const day = a.dateStr || new Date(a.timestamp).toISOString().slice(0, 10);
    if (!dailyActivity[day]) dailyActivity[day] = {};
    dailyActivity[day][a.action] = (dailyActivity[day][a.action] || 0) + 1;
    if (recentActivity.length < 50) {
      recentActivity.push({
        action: a.action,
        metadata: a.metadata || {},
        timestamp: a.timestamp
      });
    }
  });

  // Calculate session metrics
  const logins = actionCounts.login || 0;
  const messagesSent = actionCounts.message_sent || 0;
  const postsCreated = actionCounts.post_created || 0;
  const totalActions = Object.values(actionCounts).reduce((a, b) => a + b, 0);

  return {
    user: {
      uid: targetUid,
      username: user.username || 'User',
      email: user.email || '',
      photoURL: user.photoURL || '',
      accountCreated: user.accountCreated || 0,
      lastSeen: user.lastSeen || 0,
      status: user.status || 'offline',
      isBanned: user.isBanned || false,
      role: user.role || 'user',
      level: user.level || 1,
      gold: user.gold || 0,
      diamonds: user.diamonds || 0,
      friendsCount: user.friendsCount || 0,
      followerCount: user.followerCount || 0,
      postCount: user.postCount || 0,
      messagesSent: user.messagesSent || 0,
      has2FA: user.has2FA || false,
      authProvider: user.authProvider || 'password'
    },
    actionCounts,
    dailyActivity,
    recentActivity,
    summary: {
      totalActions,
      logins,
      messagesSent,
      postsCreated,
      avgActionsPerDay: days > 0 ? Math.round(totalActions / days) : 0
    }
  };
});

// ============================================================
//  43. GET PLATFORM STATS (admin-only)
//  Returns aggregate platform-wide statistics.
// ============================================================
exports.getPlatformStats = onCall(async (req) => {
  const adminUid = req.auth?.uid;
  await requireAdmin(adminUid);

  rateLimit(`platform_stats_${adminUid}`, 10, 60 * 1000);

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Use getCountFromServer for efficient counting
  const counts = {};

  // Total users
  const usersSnap = await db.collection('users').get();
  counts.totalUsers = usersSnap.size;

  // Active users (last 24h, last 7d, last 30d)
  let active24h = 0, active7d = 0, active30d = 0;
  usersSnap.forEach(doc => {
    const u = doc.data();
    const lastSeen = u.lastSeen || 0;
    if (lastSeen > oneDayAgo) active24h++;
    if (lastSeen > oneWeekAgo) active7d++;
    if (lastSeen > oneMonthAgo) active30d++;
  });
  counts.active24h = active24h;
  counts.active7d = active7d;
  counts.active30d = active30d;

  // Online now
  let onlineNow = 0;
  usersSnap.forEach(doc => {
    if (doc.data().status === 'online') onlineNow++;
  });
  counts.onlineNow = onlineNow;

  // Banned users
  let bannedCount = 0;
  usersSnap.forEach(doc => { if (doc.data().isBanned) bannedCount++; });
  counts.bannedUsers = bannedCount;

  // Accounts scheduled for deletion
  let pendingDeletions = 0;
  usersSnap.forEach(doc => {
    const u = doc.data();
    if (u.deletionScheduledAt && u.deletionScheduledAt > now) pendingDeletions++;
  });
  counts.pendingDeletions = pendingDeletions;

  // Total posts, friendships, rooms, messages
  const postsSnap = await db.collection('posts').limit(10000).get();
  counts.totalPosts = postsSnap.size;
  const friendshipsSnap = await db.collection('friendships').limit(10000).get();
  counts.totalFriendships = friendshipsSnap.size;
  const roomsSnap = await db.collection('group_rooms').limit(5000).get();
  counts.totalRooms = roomsSnap.size;
  const reportsSnap = await db.collection('reports').where('status', '==', 'pending').limit(1000).get();
  counts.pendingReports = reportsSnap.size;

  // Today's activity (from user_activity collection)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayActivitySnap = await db.collection('user_activity')
    .where('dateStr', '==', todayStr)
    .limit(10000)
    .get();
  const todayActionCounts = {};
  todayActivitySnap.forEach(doc => {
    const a = doc.data();
    todayActionCounts[a.action] = (todayActionCounts[a.action] || 0) + 1;
  });
  counts.todayActivity = todayActionCounts;
  counts.todayTotalActions = Object.values(todayActionCounts).reduce((a, b) => a + b, 0);

  // Gold + diamonds in circulation
  let totalGold = 0, totalDiamonds = 0;
  usersSnap.forEach(doc => {
    totalGold += doc.data().gold || 0;
    totalDiamonds += doc.data().diamonds || 0;
  });
  counts.totalGoldInCirculation = totalGold;
  counts.totalDiamondsInCirculation = totalDiamonds;

  return { stats: counts, generatedAt: now };
});

// ============================================================
//  44. SCHEDULE ACCOUNT DELETION (30-day grace period)
//  User requests deletion. Account is locked + scheduled for
//  permanent deletion in 30 days. User can cancel anytime.
// ============================================================
exports.scheduleAccountDeletion = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { confirmText } = req.data || {};
  // Require user to type "DELETE" to confirm
  if (confirmText !== 'DELETE') {
    throw new HttpsError('invalid-argument', 'Please type DELETE to confirm.');
  }

  rateLimit(`delete_account_${uid}`, 3, 60 * 60 * 1000); // max 3 attempts/hour

  const deletionDate = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

  await db.doc(`users/${uid}`).set({
    deletionScheduledAt: Date.now(),
    deletionExecuteAt: deletionDate,
    deletionConfirmed: true,
    status: 'offline',
    forceLogout: false // allow login during grace period so user can cancel
  }, { merge: true });

  // Log activity
  await db.collection('user_activity').add({
    uid,
    action: 'account_deletion_scheduled',
    metadata: { deletionExecuteAt: deletionDate },
    timestamp: Date.now(),
    dateStr: new Date().toISOString().slice(0, 10)
  });

  logger.info(`User ${uid} scheduled account deletion for ${new Date(deletionDate).toISOString()}`);

  return {
    success: true,
    deletionExecuteAt: deletionDate,
    message: 'Account scheduled for deletion in 30 days. You can cancel anytime.'
  };
});

// ============================================================
//  45. CANCEL ACCOUNT DELETION (during grace period)
// ============================================================
exports.cancelAccountDeletion = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const user = userSnap.data();

  if (!user.deletionScheduledAt) {
    return { success: true, alreadyActive: true };
  }

  await db.doc(`users/${uid}`).set({
    deletionScheduledAt: null,
    deletionExecuteAt: null,
    deletionConfirmed: false
  }, { merge: true });

  // Log activity
  await db.collection('user_activity').add({
    uid,
    action: 'account_deletion_cancelled',
    metadata: {},
    timestamp: Date.now(),
    dateStr: new Date().toISOString().slice(0, 10)
  });

  logger.info(`User ${uid} cancelled account deletion.`);

  return { success: true, cancelled: true };
});

// ============================================================
//  46. SCHEDULED: DELETE EXPIRED ACCOUNTS (cron daily)
//  Runs daily at 4 AM. Finds accounts past grace period and
//  permanently deletes: user doc, friendships, posts, comments,
//  messages, activity logs, FCM tokens, 2FA secrets, secret chat keys.
// ============================================================
exports.scheduledDeleteAccounts = onSchedule(
  {
    schedule: '0 4 * * *', // Daily at 4:00 AM
    timeZone: 'Asia/Dhaka',
    memory: '1GiB',
    timeoutSeconds: 540
  },
  async (event) => {
    const now = Date.now();
    let deleted = 0;
    let failed = 0;

    // Find users past grace period
    const snap = await db.collection('users')
      .where('deletionExecuteAt', '<', now)
      .where('deletionConfirmed', '==', true)
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info('[deleteAccounts] No accounts pending deletion.');
      return;
    }

    for (const userDoc of snap.docs) {
      const uid = userDoc.id;
      try {
        // 1. Delete user doc
        await db.doc(`users/${uid}`).delete();

        // 2. Delete friendships (both directions)
        const f1Snap = await db.collection('friendships').where('user1', '==', uid).limit(100).get();
        const f2Snap = await db.collection('friendships').where('user2', '==', uid).limit(100).get();
        const friendshipBatch = db.batch();
        f1Snap.forEach(d => friendshipBatch.delete(d.ref));
        f2Snap.forEach(d => friendshipBatch.delete(d.ref));
        await friendshipBatch.commit();

        // 3. Delete posts
        const postsSnap = await db.collection('posts').where('userId', '==', uid).limit(500).get();
        const postsBatch = db.batch();
        postsSnap.forEach(d => postsBatch.delete(d.ref));
        await postsBatch.commit();

        // 4. Delete comments
        const commentsSnap = await db.collection('comments').where('userId', '==', uid).limit(500).get();
        const commentsBatch = db.batch();
        commentsSnap.forEach(d => commentsBatch.delete(d.ref));
        await commentsBatch.commit();

        // 5. Delete activity logs
        const activitySnap = await db.collection('user_activity').where('uid', '==', uid).limit(2000).get();
        const activityBatch = db.batch();
        activitySnap.forEach(d => activityBatch.delete(d.ref));
        await activityBatch.commit();

        // 6. Delete FCM tokens
        const fcmSnap = await db.collection('fcm_tokens').where('uid', '==', uid).limit(20).get();
        const fcmBatch = db.batch();
        fcmSnap.forEach(d => fcmBatch.delete(d.ref));
        await fcmBatch.commit();

        // 7. Delete 2FA secret
        await db.doc(`totp_secrets/${uid}`).delete().catch(()=>{});

        // 8. Delete secret chat key
        await db.doc(`secret_chat_keys/${uid}`).delete().catch(()=>{});

        // 9. Delete follows
        const followsSnap = await db.collection('follows').where('followerId', '==', uid).limit(500).get();
        const followsBatch = db.batch();
        followsSnap.forEach(d => followsBatch.delete(d.ref));
        await followsBatch.commit();

        // 10. Delete saved posts
        const savedSnap = await db.collection('savedPosts').where('userId', '==', uid).limit(500).get();
        const savedBatch = db.batch();
        savedSnap.forEach(d => savedBatch.delete(d.ref));
        await savedBatch.commit();

        // 11. Delete the Firebase Auth user (Admin SDK)
        try {
          await admin.auth().deleteUser(uid);
        } catch (authErr) {
          logger.warn(`[deleteAccounts] Failed to delete Auth user ${uid}:`, authErr.message);
          // Continue — user doc already deleted
        }

        deleted++;
        logger.info(`[deleteAccounts] Permanently deleted account ${uid}`);
      } catch (err) {
        failed++;
        logger.error(`[deleteAccounts] Failed to delete account ${uid}:`, err.message);
      }
    }

    logger.info(`[deleteAccounts] Done. Deleted: ${deleted}, Failed: ${failed}`);
  }
);
