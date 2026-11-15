'use strict';

// Run locally with Application Default Credentials or a securely stored service account.
// Never commit service account keys, passwords, or user-specific IDs.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const projectId = process.env.FIREBASE_PROJECT_ID;
const masterUid = process.env.DOMINION_TEST_MASTER_UID;
const daisyUid = process.env.DOMINION_TEST_DAISY_UID;

if (projectId !== 'dominionapp-45bfa' || !masterUid || !daisyUid || masterUid === daisyUid) {
  console.error('Set FIREBASE_PROJECT_ID, DOMINION_TEST_MASTER_UID and DOMINION_TEST_DAISY_UID (distinct).');
  process.exit(1);
}

initializeApp({ projectId });

(async () => {
  for (const [role, uid] of [['Master', masterUid], ['Daisy', daisyUid]]) {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    // Preserve any existing claims; only set the isolated test role.
    await auth.setCustomUserClaims(uid, {
      ...(user.customClaims || {}),
      dominionTestRole: role,
    });
    console.log('Assigned Dominion-Test role:', role, 'to existing Firebase user.');
  }
  console.log('Roles assigned. Users must refresh their Firebase ID tokens by signing in again.');
})().catch(err => {
  console.error('Role assignment failed:', err.message);
  process.exitCode = 1;
});
