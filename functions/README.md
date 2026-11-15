# Dominion-Test Push – sichere Vorbereitungsstufe

**Noch nicht deployen.** Die Dateien sind ein Backend-Entwurf, keine aktive Push-Funktion.

## Vorbedingungen
1. Firebase Authentication einrichten; Master und Daisy benötigen jeweils eigene Auth-Konten.
2. Rollen durch vertrauenswürdige Admin-Seite als Firebase Auth Custom Claims `dominionTestRole` setzen. Ein Rollenknopf in der Web-App ist **kein** Authentifizierungsnachweis.
3. Firebase App Check für die Web-App einrichten und die Callable Function testen.
4. Realtime Database Rules: Schreib-/Lesezugriff auf `pushDevices` für alle Clients **verweigern**. Cloud Functions Admin SDK darf weiterhin zugreifen.
5. Client um Firebase Auth und Functions SDK ergänzen; nach erfolgreicher Anmeldung das bereits vorhandene FCM-Token mit stabiler gerätebezogener ID an `registerTestPushDevice` senden. Bis dahin liegen Tokens ausschließlich lokal auf dem Gerät.
6. Vor Deployment RTDB-Instanzname, Region, Firebase CLI Login, Functions-Runtime, Security Rules und Kostenlimits prüfen. Das Projekt wird mit der Produktiv-App geteilt.
7. Zunächst nur synthetische Chatnachrichten im Testraum verwenden.

## Architektur
- `registerTestPushDevice`: authentifizierte, App-Check-geschützte Token-Registrierung pro Rolle/Gerät.
- `notifyTestChat`: RTDB-Trigger **nur** für `rooms/dominion-test-20261114-isolated/chat`; sendet an die andere Rolle.
- Kein FCM Server Key und kein Service-Account-Key im öffentlichen Repository.
- Die vorhandene Chat-Array-Struktur wird vorerst nur gelesen; Migration zu einzelnen Chat-Knoten wäre langfristig besser.

## Wichtige Einschränkungen
- Noch kein automatischer Push, bis die Vorbedingungen erfüllt und die Functions bereitgestellt sind.
- Für RTDB-Trigger muss die richtige Datenbankinstanz und Region vor Deployment bestätigt werden.
- Bei RTDB-Triggern ist die Zustellung mindestens einmal möglich; Duplikate sollten vor dem Produktiveinsatz durch Event-ID-Deduplizierung ausgeschlossen werden.
- Budgetwarnungen sind keine harte Kostenobergrenze.
