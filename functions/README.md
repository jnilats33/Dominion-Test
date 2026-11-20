# Dominion-Test Push – Stand nach Chat-v2-Umstellung

Die bisher bereitgestellte Funktion `notifyTestChat` überwacht den alten Pfad `/rooms/dominion-test-20261114-isolated/chat`.

Die neue Funktion `notifyTestChatV2` ist im Quellcode vorbereitet und überwacht ausschließlich neu angelegte Nachrichten unter `/rooms/dominion-test-20261114-isolated/chatV2/{messageId}`. Sie wurde durch den GitHub-Commit **nicht** bereitgestellt.

## Sicheres Vorgehen
1. Vor dem Deployment aktives Firebase-Projekt `dominionapp-45bfa`, RTDB-Instanz `dominionapp-45bfa-default-rtdb` und Region `europe-west1` prüfen.
2. In der Firebase Console prüfen, ob Master und Daisy über `registerTestPushDevice` jeweils registriert sind. Keine Push-Tokens öffentlich teilen.
3. Ausschließlich die neue Funktion bereitstellen: `firebase deploy --only functions:notifyTestChatV2 --project dominionapp-45bfa`.
4. Erst mit einer neuen Textnachricht im isolierten Testraum testen. Logs und Empfang auf dem Zielgerät kontrollieren.
5. Die alte Funktion `notifyTestChat` erst nach erfolgreicher Prüfung gesondert stilllegen. Keine pauschale Bereitstellung aller Functions durchführen.

## Grenzen
- Das Firebase-Projekt wird mit Produktiv geteilt; Deployments verändern Cloud-Ressourcen dieses Projekts.
- Das Bereitstellen eines neuen RTDB-Triggers kann Berechtigungen, aktivierte APIs und Abrechnung voraussetzen.
- FCM-Zustellung setzt erfolgreiche Token-Registrierung und Browser-Berechtigung voraus.
- Realtime-Database-Trigger können mehrfach zugestellt werden. Für Produktion ist eine Deduplizierung notwendig.
- Alte Chatnachrichten werden nicht migriert oder gelöscht.
