'use strict';

// Dominion-Test: backend scaffold. No deployment before secure client authentication
// and restricted RTDB rules are configured.
const { onValueWritten } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const ROOM = 'dominion-test-20261114-isolated';
const REGION = 'europe-west1';
const ROLES = new Set(['Master', 'Daisy']);

function verifiedRole(request) {
  // Only Firebase Auth custom claims issued by a trusted administrator count.
  const role = request.auth?.token?.dominionTestRole;
  if (!ROLES.has(role)) throw new HttpsError('permission-denied', 'Verified test role required.');
  return role;
}

exports.registerTestPushDevice = onCall({
  region: REGION,
  maxInstances: 2,
  enforceAppCheck: true,
}, async (request) => {
  const role = verifiedRole(request);
  const { token, deviceId } = request.data || {};
  if (typeof token !== 'string' || token.length < 50 || token.length > 4096 ||
      typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(deviceId)) {
    throw new HttpsError('invalid-argument', 'Invalid device registration.');
  }
  // Token paths are server-owned and must be denied to RTDB clients.
  await getDatabase().ref(`pushDevices/${ROOM}/${role}/${deviceId}`).set({
    token,
    updatedAt: Date.now(),
  });
  return { registered: true };
});

exports.notifyTestChat = onValueWritten({
  ref: `/rooms/${ROOM}/chat`,
  instance: 'dominionapp-45bfa-default-rtdb',
  region: REGION,
  maxInstances: 2,
  retry: false,
}, async (event) => {
  // Chat is currently an array rewritten by RTDB transactions. Only new IDs
  // trigger notifications; edits, deletes and reordering do not.
  const before = event.data.before.val();
  const after = event.data.after.val();
  const oldMessages = Array.isArray(before) ? before : Object.values(before || {});
  const newMessages = Array.isArray(after) ? after : Object.values(after || {});
  const oldIds = new Set(oldMessages.filter(m => m && m.id).map(m => String(m.id)));
  const added = newMessages.filter(m => m && m.id && !oldIds.has(String(m.id)));
  // Guard against accidental bulk replay during migration or room initialization.
  if (!added.length || added.length > 5) return;

  for (const message of added) {
    if (!ROLES.has(message.sender)) continue;
    const recipient = message.sender === 'Master' ? 'Daisy' : 'Master';
    const devicesSnapshot = await getDatabase().ref(`pushDevices/${ROOM}/${recipient}`).get();
    const devices = devicesSnapshot.val() || {};
    const entries = Object.entries(devices).filter(([, v]) => typeof v?.token === 'string');
    if (!entries.length) continue;
    const tokens = entries.map(([, v]) => v.token);
    const response = await getMessaging().sendEachForMulticast({
      tokens,
      data: {
        title: 'Dominion-Test',
        body: message.audio ? 'Neue Sprachnachricht' : message.image ? 'Neue Bildnachricht' : 'Neue Chatnachricht',
        url: 'https://jnilats33.github.io/Dominion-Test/',
      },
      webpush: { fcmOptions: { link: 'https://jnilats33.github.io/Dominion-Test/' } },
    });
    const invalid = [];
    response.responses.forEach((result, i) => {
      if (!result.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code)) {
        invalid.push(entries[i][0]);
      }
    });
    await Promise.all(invalid.map(id => getDatabase().ref(`pushDevices/${ROOM}/${recipient}/${id}`).remove()));
  }
});
