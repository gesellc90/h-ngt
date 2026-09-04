# Automatischer Mailversand der Monatsabrechnungen (M15)

Versendet am 1. eines Monats die Getränkeabrechnung des Vormonats per Mail:

- **An jedes aktive Mitglied mit hinterlegter E-Mail-Adresse und Verbrauch > 0 €**
  im Monat: kurzer Text mit dem Gesamtbetrag, die eigene Abrechnung als PDF im
  Anhang.
- **An die Wirtschaftskommission** (`MAIL_SUMMARY_TO`, optional
  `MAIL_SUMMARY_CC`): kurzer Text mit den Kennzahlen des Monats, vier Anhänge —
  Sammel-Abrechnung aller Mitglieder (PDF + CSV) und Zeiger-Übersicht des
  Monats (PDF + CSV).

Genutzt wird das bestehende SMTP-Postfach des Vereins bei df.eu
(`sslout.df.eu:465`, implizites TLS).

## Inbetriebnahme

In dieser Reihenfolge — nicht überspringen, jeder Schritt schützt vor einem
Fehlversand an alle Mitglieder:

1. **Deployen mit `MAIL_ENABLED=false`.** Das ist der Standardwert — ohne
   diesen Schritt läuft die App bereits problemlos, der Mailversand ist
   einfach nur aus.
2. **Zugangsdaten eintragen.** In `/etc/getraenke/env` auf dem Pi (Mode 0640,
   `root:getraenke` — siehe [`DEPLOYMENT.md`](./DEPLOYMENT.md)) `SMTP_USER`,
   `SMTP_PASS`, `MAIL_FROM`, `MAIL_SUMMARY_TO` (und optional
   `MAIL_SUMMARY_CC`) setzen. **Niemals ins Repo committen** — die Vorlage in
   `backend/.env.example` enthält bewusst keine echten Werte.
3. **`MAIL_ENABLED=true` setzen, Service neu starten.**
   ```bash
   sudo systemctl restart getraenke.service
   ```
4. **Testmail.** Admin-Oberfläche → „Mailversand" → Testmail an die eigene
   Adresse. Das prüft SMTP-Verbindung und Zugangsdaten, ohne eine Abrechnung
   zu versenden. Schlägt es fehl, siehe [Fehlerbehebung](#fehlerbehebung).
5. **Vorschau prüfen.** „Vorschau (Dry-Run)" für den Vormonat — zeigt, wer was
   bekäme und warum jemand übersprungen würde (keine E-Mail hinterlegt, kein
   Verbrauch, bereits versendet). Es wird dabei nichts versendet oder
   gespeichert.
6. **Einmal manuell versenden**, um den echten Ablauf zu sehen, bevor er
   automatisch läuft.
7. **Erst danach `MAIL_SCHEDULE_ENABLED=true` setzen.** Ab jetzt prüft die App
   stündlich, ob der 1. des Monats und die konfigurierte Stunde
   (`MAIL_SCHEDULE_HOUR`, Default 3 Uhr, Europe/Berlin) erreicht sind, und
   versendet dann automatisch den Vormonat.

## Idempotenz & Ausfallsicherheit

Jede versendete oder fehlgeschlagene Mail wird in der Tabelle
`mail_dispatches` protokolliert. Ein erneuter Lauf für denselben Monat
(egal ob durch den Scheduler nach einem Neustart oder durch einen zweiten
Klick auf „Jetzt versenden") verschickt nichts doppelt — bereits erfolgreich
versendete Empfänger werden übersprungen, fehlgeschlagene automatisch erneut
versucht.

Der Vereins-Pi läuft nicht zwingend 24/7. War er über den Monatswechsel aus,
holt der nächste stündliche Check (spätestens beim nächsten Boot) den
Versand automatisch nach — der 1. des Monats muss nicht exakt getroffen
werden. **Das deckt aber nur den unmittelbar vorherigen Monat ab.** War der
Pi länger als einen Kalendermonat aus, muss der übersprungene Monat über
„Jetzt versenden" in der Admin-Oberfläche manuell nachgeholt werden.

## Admin-Oberfläche (`/admin/mail`)

- **Status**: Versand aktiv/inaktiv, SMTP-Ziel, Empfänger der Sammelabrechnung,
  automatischer Zeitplan.
- **Testmail**: an eine frei wählbare Adresse.
- **Vorschau (Dry-Run)**: Monat wählen → Tabelle mit geplanten Empfängern,
  Beträgen und Skip-Gründen. Kein Versand.
- **Jetzt versenden**: löst den echten Versand für den gewählten Monat aus.
- **Versandprotokoll**: zeigt für den gewählten Monat, was bereits passiert
  ist (Zeitpunkt, Empfänger, Status, Auslöser, Fehlermeldung). Ein
  fehlgeschlagener Eintrag wird durch erneutes Klicken auf „Jetzt versenden"
  automatisch nachversucht.

## Fehlerbehebung

| Symptom                                  | Ursache                                             | Lösung                                                                      |
| ---------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Testmail: 503 `MAIL_DISABLED`            | `MAIL_ENABLED=false`                                | ENV setzen, Service neu starten                                             |
| Testmail: 502, „Authentication failed"   | Falscher `SMTP_USER`/`SMTP_PASS`                    | Zugangsdaten im df.eu-Kundenmenü prüfen                                     |
| Testmail: 502, Timeout/`ECONNREFUSED`    | Ausgehender Port 465 im Vereins-WLAN blockiert      | Firewall/Router prüfen; alternativ Port 587 mit `SMTP_SECURE=false`         |
| Mitglied bekommt keine Abrechnung        | Keine E-Mail hinterlegt oder Verbrauch 0 € im Monat | In der Vorschau nachsehen — beides ist als Skip-Grund sichtbar, kein Fehler |
| „Jetzt versenden" tut scheinbar nichts   | Für den Monat wurde bereits erfolgreich versendet   | Versandprotokoll prüfen — Idempotenz ist beabsichtigt                       |
| POST /mail/dispatch: 503 `MAIL_DISABLED` | `MAIL_ENABLED=false`                                | ENV setzen, Service neu starten                                             |

## E-Mail-Verifizierung (M16)

Mitglieder können ihre hinterlegte Adresse per Bestätigungslink verifizieren
— nutzt denselben `MailService`/SMTP-Weg wie oben, ist aber technisch und
organisatorisch unabhängig vom Monatsabrechnungs-Versand:

- **Kein Gating.** Der Verifizierungsstatus ist rein informativ (Badge im
  Profil/Admin-UI). Der Monatsabrechnungs-Versand geht weiterhin an alle
  hinterlegten Adressen, verifiziert oder nicht.
- **Auslöser:** automatisch bei jeder tatsächlichen Adressänderung
  (`PATCH /auth/me`, `PATCH /members/:id`) sowie über den
  „Bestätigungsmail erneut senden"-Button im Profil.
- **`APP_BASE_URL`** muss auf die vom Frontend erreichbare Basis-URL zeigen
  (siehe [`DEPLOYMENT.md`](./DEPLOYMENT.md)) — sonst zeigt der Link in der
  Mail ins Leere oder auf die falsche Adresse.
- Funktioniert unabhängig von `MAIL_ENABLED`: Ist der Versand deaktiviert,
  wird die Adresse trotzdem gespeichert, nur die Mail selbst wird
  übersprungen und geloggt. Der explizite Resend-Button gibt in dem Fall
  denselben 503 `MAIL_DISABLED` zurück wie die Testmail oben.

## Bekannte Einschränkung

`ReportService.calculateAllZeiger` filtert Zeiger nach dem UTC-Datum von
`opened_at`, nicht nach der Vereinszeitzone (Europe/Berlin). Ein Zeiger, der
kurz nach Mitternacht Berliner Zeit am Monatsersten eröffnet wurde, kann
dadurch noch dem Vormonat zugerechnet werden. Das ist bestehendes Verhalten
der Berichte-Seite — die gemailte Zeiger-Übersicht ist damit konsistent zu
dem, was ein Admin dort manuell exportieren würde.
