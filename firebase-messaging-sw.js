// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase Konfiguration für den Service Worker
firebase.initializeApp({
  "apiKey": "AIzaSyC3YyPJsXsX-u2EHKHcByPVj1Ru2Fn3YPo",
  "authDomain": "dominionapp-45bfa.firebaseapp.com",
  "databaseURL": "https://dominionapp-45bfa-default-rtdb.europe-west1.firebasedatabase.app",
  "projectId": "dominionapp-45bfa",
  "storageBucket": "dominionapp-45bfa.firebasestorage.app",
  "messagingSenderId": "1047436704498",
  "appId": "1:1047436704498:web:4b7f9b229b5ad7cc0fee6b"
});

const messaging = firebase.messaging();

// Hintergrund-Nachrichten empfangen und als System-Benachrichtigung anzeigen
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Hintergrundnachricht empfangen:', payload);
  
  const notificationTitle = payload.notification?.title || 'Dominion App';
  const notificationOptions = {
    body: payload.notification?.body || 'Neue Aktivität im System.',
    icon: './favicon.ico',
    badge: './favicon.ico',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});