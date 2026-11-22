'use strict';

// Dominion-Test: backend scaffold. No deployment before secure client authentication
// and restricted RTDB rules are configured.
const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');

initializeApp();

const ROOM = 'dominion-test-20261114-isolated';
const REGION = 'europe-west1';
const ROLES = new Set(['Master', 'Daisy']);
const ROLE_UIDS = Object.freeze({
  Master: 'ctgxl53FnFfeG75Z3tCiDnijbG43',
  Daisy: 'WH2QtbiWtdcIPgo2VuXu1xPyhD13',
});

function verifiedRole(request) {
  // Match the same UID + custom-claim pair required by the live RTDB rules.
  const role = request.auth?.token?.dominionTestRole;
  const uid = request.auth?.uid;
  if (!ROLES.has(role) || ROLE_UIDS[role] !== uid)
    throw new HttpsError('permission-denied', 'Verified test role and account required.');
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

// New function name deliberately leaves the deployed legacy trigger untouched.
// Deploy only notifyTestChatV2 after checking the Firebase project and region.
exports.notifyTestChatV2 = onValueCreated({
  ref: `/rooms/${ROOM}/chatV2/{messageId}`,
  instance: 'dominionapp-45bfa-default-rtdb',
  region: REGION,
  maxInstances: 2,
  retry: false,
}, async (event) => {
  const message = event.data.val();
  if (!message || !ROLES.has(message.sender) ||
      typeof message.id !== 'string' || message.id !== event.params.messageId) {
    logger.warn('test_push_skipped_invalid_message', {
      hasMessage: !!message,
      senderRoleValid: ROLES.has(message?.sender),
      messageIdValid: typeof message?.id === 'string' && message.id === event.params.messageId,
    });
    return;
  }

  const recipient = message.sender === 'Master' ? 'Daisy' : 'Master';
  const chatPreference = await getDatabase().ref('pushPreferences/'+ROOM+'/'+recipient+'/chat').get();
  if (chatPreference.val() === false) return;
  logger.info('test_push_message_received', { sender: message.sender, recipient });

  const devicesSnapshot = await getDatabase().ref(`pushDevices/${ROOM}/${recipient}`).get();
  const devices = devicesSnapshot.val() || {};
  const entries = Object.entries(devices).filter(([, v]) => typeof v?.token === 'string');
  logger.info('test_push_recipient_devices', { recipient, registeredDevices: entries.length });
  if (!entries.length) return;

  const selected = entries.slice(0, 500); // FCM multicast limit.
  const tokens = selected.map(([, v]) => v.token);
  try {
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
    const errorCounts = {};
    response.responses.forEach((result, i) => {
      if (!result.success) {
        const code = result.error?.code || 'unknown';
        errorCounts[code] = (errorCounts[code] || 0) + 1;
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
          invalid.push(selected[i][0]);
        }
      }
    });
    logger.info('test_push_fcm_result', {
      recipient,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errorCounts,
    });
    await Promise.all(invalid.map(id => getDatabase().ref(`pushDevices/${ROOM}/${recipient}/${id}`).remove()));
  } catch (error) {
    logger.error('test_push_send_exception', { recipient, code: error.code || 'unknown' });
    throw error;
  }
});



const PUSH_EVENTS = new Set(['chat','task','taskReview','calendar','shopping','rewards','penalty']);
const PUSH_PREF_PATH = 'pushPreferences/' + ROOM;
exports.getTestPushPreferences = onCall({region:REGION,maxInstances:2,enforceAppCheck:true},async request => {
  const role=verifiedRole(request);
  const snapshot=await getDatabase().ref(PUSH_PREF_PATH+'/'+role).get();
  const saved=snapshot.val() || {};
  return {preferences:Object.fromEntries([...PUSH_EVENTS].map(key=>[key,saved[key]!==false]))};
});
exports.setTestPushPreference = onCall({region:REGION,maxInstances:2,enforceAppCheck:true},async request => {
  const role=verifiedRole(request);
  const {event,enabled}=request.data || {};
  if(!PUSH_EVENTS.has(event)||typeof enabled!=='boolean')
    throw new HttpsError('invalid-argument','Invalid push preference.');
  await getDatabase().ref(PUSH_PREF_PATH+'/'+role+'/'+event).set(enabled);
  return {saved:true};
});

// Reuse the existing test FCM device registry and delivery mechanism.
// These listeners do not modify app data and are scoped to the isolated test room.
async function notifyOtherRole(sender, recipient, title, body, kind, preferenceKey = kind) {
  if (!ROLES.has(sender) || !ROLES.has(recipient) || sender === recipient) return;
  if (!PUSH_EVENTS.has(preferenceKey)) return;
  const preference=await getDatabase().ref(PUSH_PREF_PATH+'/'+recipient+'/'+preferenceKey).get();
  if (preference.val() === false) return;
  const snapshot = await getDatabase().ref(`pushDevices/${ROOM}/${recipient}`).get();
  const devices = Object.entries(snapshot.val() || {}).filter(([, value]) => typeof value?.token === 'string');
  if (!devices.length) return;
  const selected = devices.slice(0, 500);
  const response = await getMessaging().sendEachForMulticast({
    tokens: selected.map(([, value]) => value.token),
    data: {
      title: String(title).slice(0, 100),
      body: String(body).slice(0, 220),
      kind,
      url: 'https://jnilats33.github.io/Dominion-Test/',
    },
    webpush: { fcmOptions: { link: 'https://jnilats33.github.io/Dominion-Test/' } },
  });
  const invalid = [];
  response.responses.forEach((result, index) => {
    if (!result.success && ['messaging/registration-token-not-registered',
      'messaging/invalid-registration-token'].includes(result.error?.code)) {
      invalid.push(selected[index][0]);
    }
  });
  await Promise.all(invalid.map(id => getDatabase().ref(`pushDevices/${ROOM}/${recipient}/${id}`).remove()));
  logger.info('test_push_domain_result', {kind, recipient, successCount: response.successCount,
    failureCount: response.failureCount});
}

function otherRole(sender) {
  return sender === 'Master' ? 'Daisy' : sender === 'Daisy' ? 'Master' : null;
}

function newEntries(before, after) {
  const previousIds = new Set((Array.isArray(before) ? before : []).filter(Boolean).map(item => item.id));
  return (Array.isArray(after) ? after : []).filter(item =>
    item && typeof item.id === 'string' && !previousIds.has(item.id));
}

exports.notifyTestTaskCreated = onValueWritten({
  ref: `/rooms/${ROOM}/mgmt/aufgaben`,
  instance: 'dominionapp-45bfa-default-rtdb',
  region: REGION, maxInstances: 2, retry: false,
}, async (event) => {
  const created = newEntries(event.data.before.val(), event.data.after.val());
  for (const task of created.slice(0, 20)) {
    const sender = task.createdBy;
    if (!ROLES.has(sender) || task.assignee !== otherRole(sender)) continue;
    await notifyOtherRole(sender, task.assignee, 'Neue Aufgabe für dich',
      `${sender} hat dir eine Aufgabe zugewiesen: ${task.title || 'Ohne Titel'}`, 'task', 'task');
  }
});

exports.notifyTestCalendarChanged = onValueWritten({
  ref: `/rooms/${ROOM}/kalender`,
  instance: 'dominionapp-45bfa-default-rtdb',
  region: REGION, maxInstances: 2, retry: false,
}, async (event) => {
  const before = Array.isArray(event.data.before.val()) ? event.data.before.val() : [];
  const after = Array.isArray(event.data.after.val()) ? event.data.after.val() : [];
  const oldById = new Map(before.filter(item => item?.id).map(item => [item.id, item]));
  const notifiedGroups = new Set();
  for (const entry of after) {
    if (!entry?.id) continue;
    const previous = oldById.get(entry.id);
    const sender = previous ? entry.lastEditedBy : entry.createdBy;
    // For edits, the editor must be recorded by the client; never guess who changed it.
    if (!ROLES.has(sender) || entry.owner !== otherRole(sender)) continue;
    if (previous && ['title','date','time','endDate','endTime','owner'].every(key =>
      (previous[key] || '') === (entry[key] || ''))) continue;
    const dedupeKey = `${entry.groupId || entry.id}:${sender}:${previous ? 'edit' : 'new'}`;
    if (notifiedGroups.has(dedupeKey)) continue;
    notifiedGroups.add(dedupeKey);
    await notifyOtherRole(sender, entry.owner,
      previous ? 'Termin geändert' : 'Neuer Termin für dich',
      `${sender} hat ${previous ? 'deinen Termin geändert' : 'einen Termin eingetragen'}: ${entry.title || 'Ohne Titel'} (${entry.date || ''} ${entry.time || ''})`,
      previous ? 'calendar-updated' : 'calendar-created', 'calendar');
  }
});


function changedRows(before,after) {
  const prev=new Map((Array.isArray(before)?before:[]).filter(x=>x?.id).map(x=>[x.id,x]));
  return (Array.isArray(after)?after:[]).filter(x=>x?.id && JSON.stringify(prev.get(x.id))!==JSON.stringify(x))
    .map(x=>({old:prev.get(x.id),item:x}));
}
function changedFields(old,item,keys) {
  return keys.some(key => JSON.stringify(old?.[key] ?? null) !== JSON.stringify(item?.[key] ?? null));
}
exports.notifyTestShopping = onValueWritten({
  ref:`/rooms/${ROOM}/einkauf`,instance:'dominionapp-45bfa-default-rtdb',
  region:REGION,maxInstances:2,retry:false
},async event=>{
  for(const {old,item} of changedRows(event.data.before.val(),event.data.after.val()).slice(0,20)){
    if(old && !changedFields(old,item,['name','note','done']))continue;
    const actor=old?item.lastEditedBy:item.createdBy;
    if(!ROLES.has(actor))continue;
    await notifyOtherRole(actor,otherRole(actor),'Einkaufsliste',
      old?'Einkaufsartikel geändert':'Neuer Einkaufsartikel','shopping');
  }
});
exports.notifyTestPenalty = onValueWritten({
  ref:`/rooms/${ROOM}/strafbuch`,instance:'dominionapp-45bfa-default-rtdb',
  region:REGION,maxInstances:2,retry:false
},async event=>{
  for(const {old,item} of changedRows(event.data.before.val(),event.data.after.val()).slice(0,20)){
    if(old && !changedFields(old,item,['reason','measure','resolved']))continue;
    const actor=old?item.lastEditedBy:item.createdBy;
    if(!ROLES.has(actor))continue;
    await notifyOtherRole(actor,otherRole(actor),'Strafbuch',
      old?'Strafbucheintrag geändert':'Neuer Strafbucheintrag','penalty');
  }
});
exports.notifyTestTaskReview = onValueWritten({
  ref:`/rooms/${ROOM}/mgmt/aufgaben`,instance:'dominionapp-45bfa-default-rtdb',
  region:REGION,maxInstances:2,retry:false
},async event=>{
  for(const {old,item} of changedRows(event.data.before.val(),event.data.after.val()).slice(0,20)){
    if(!old || old.status===item.status)continue;
    const actor=item.lastEditedBy;
    if(!ROLES.has(actor) || !['review','done','rejected','open'].includes(item.status))continue;
    await notifyOtherRole(actor,otherRole(actor),'Aufgabenstatus',
      'Status einer Aufgabe geändert','task-review','taskReview');
  }
});
exports.notifyTestRewards = onValueWritten({
  ref:`/rooms/${ROOM}/rewardLedger`,instance:'dominionapp-45bfa-default-rtdb',
  region:REGION,maxInstances:2,retry:false
},async event=>{
  for(const {old,item} of changedRows(event.data.before.val(),event.data.after.val()).slice(0,20)){
    if(old && (old.redemption?.status === item.redemption?.status ||
        item.redemption?.status !== 'completed'))continue;
    if(!old && !item.redemption)continue;
    const actor=old?item.redemption?.completedBy:item.actorRole;
    if(!ROLES.has(actor))continue;
    await notifyOtherRole(actor,otherRole(actor),'Belohnungen und Einlösungen',
      old?'Einlösung abgeschlossen':'Neue Einlösung','rewards');
  }
});
