/**
 * EINSTELLUNGEN · SCHLAFIMPORT – den Zugang für das iPhone verwalten.
 *
 * ---------------------------------------------------------------------------
 * Warum ein eigener Zugang und nicht einfach die Anmeldung
 *
 * Der iOS-Kurzbefehl kann sich nicht anmelden: Er müsste Eriks Passwort
 * speichern oder ein Supabase-Token, das nach einer Stunde abläuft. Beides
 * wäre auf einem Telefon schlechter aufgehoben als ein Zugang, der genau
 * eines darf – Schlafdaten schicken – und der sich mit einem Klick widerrufen
 * lässt, ohne dass irgendetwas anderes betroffen ist.
 *
 * ---------------------------------------------------------------------------
 * Was hier gespeichert wird
 *
 * NUR der SHA-256-Abdruck. Das Token selbst entsteht im Browser, wird einmal
 * angezeigt und danach vergessen – auch von LifeHub. Wer diese Liste liest,
 * kann daraus keinen Zugang herstellen. Deshalb gibt es auch kein „Token
 * noch einmal anzeigen": Es ist wirklich weg.
 */
import React, { useState } from 'react'
import { Card, Field, Modal, Confirm, Empty } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { formatDay } from '../../core/dates'
import { resolvedSyncUrl } from '../../sync/config'
import { erzeugeToken, tokenAbdruck } from '../../../supabase/functions/_shared/importToken'

export function SchlafImportKarte() {
  const data = useData()
  const m = useMutations()
  const [neuesToken, setNeuesToken] = useState<string | null>(null)
  const [label, setLabel] = useState('iPhone')
  const [anlegen, setAnlegen] = useState(false)
  const [widerrufen, setWiderrufen] = useState<any | null>(null)
  const [kopiert, setKopiert] = useState<'adresse' | 'token' | null>(null)

  const zugaenge = (data.importTokens ?? []).filter((t: any) => !t.deleted_at)
  const aktiv = zugaenge.filter((t: any) => !t.revoked_at)
  const adresse = `${resolvedSyncUrl(data.settings.sync_url ?? '')}/functions/v1/schlaf`

  const kopiere = (text: string, was: 'adresse' | 'token') => {
    navigator.clipboard?.writeText(text).then(
      () => { setKopiert(was); window.setTimeout(() => setKopiert(null), 1800) },
      () => m.toast('Kopieren hat nicht geklappt – bitte von Hand markieren.'),
    )
  }

  const lege = async () => {
    const token = erzeugeToken()
    const hash = await tokenAbdruck(token)
    m.create('import_tokens', {
      label: label.trim() || 'iPhone',
      token_hash: hash,
      scope: 'schlaf',
      last_used_at: null,
      revoked_at: null,
    }, 'Zugang angelegt')
    setAnlegen(false)
    setNeuesToken(token)
  }

  return (
    <Card className="mb16" title="Schlafimport vom iPhone"
      sub="Ein eigener Zugang für den Kurzbefehl, der den Schlaf aus Apple Health schickt."
      action={<button className="btn btn-sm btn-primary" onClick={() => setAnlegen(true)}>+ Zugang</button>}>

      <div className="hint-box small mb12">
        Auf dem iPhone liegt <strong>nur dieses Token</strong> – kein Passwort und
        kein Dienstschlüssel. Es darf ausschließlich Schlafdaten schicken, und ein
        Widerruf wirkt sofort, ohne dass die Synchronisation davon berührt wird.
      </div>

      <Field label="Adresse für den Kurzbefehl" hint="Im Kurzbefehl als URL eintragen.">
        <div className="row">
          <input className="input mono" readOnly value={adresse} style={{ flex: 1 }}
            onFocus={(e) => e.currentTarget.select()} />
          <button className="btn btn-sm" onClick={() => kopiere(adresse, 'adresse')}>
            {kopiert === 'adresse' ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      </Field>

      {zugaenge.length === 0 ? (
        <Empty kompakt title="Noch kein Zugang angelegt."
          hint="Ohne Zugang weist der Endpunkt jede Anfrage ab." />
      ) : (
        <div className="list">
          {zugaenge.map((t: any) => (
            <div className="list-row" key={t.id}>
              <span className="list-main">
                <span className="list-title">
                  {t.label}
                  {t.revoked_at && <span className="pill crit" style={{ marginLeft: 6 }}>widerrufen</span>}
                </span>
                <span className="list-sub">
                  angelegt {formatDay(String(t.created_at).slice(0, 10))}
                  {t.last_used_at
                    ? ` · zuletzt benutzt ${formatDay(String(t.last_used_at).slice(0, 10))}`
                    : ' · noch nie benutzt'}
                </span>
              </span>
              {!t.revoked_at && (
                <button className="btn btn-sm btn-ghost" onClick={() => setWiderrufen(t)}>Widerrufen</button>
              )}
            </div>
          ))}
        </div>
      )}

      {aktiv.length === 0 && zugaenge.length > 0 && (
        <div className="hint-box crit small mt12">
          Kein gültiger Zugang mehr – der Kurzbefehl bekommt ab jetzt „Zugang ungültig".
        </div>
      )}

      {/* ---------------------------------------------------------- Anlegen */}
      {anlegen && (
        <Modal open title="Zugang anlegen" onClose={() => setAnlegen(false)}
          footer={<>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setAnlegen(false)}>Abbrechen</button>
            <button className="btn btn-primary" onClick={lege}>Anlegen</button>
          </>}>
          <Field label="Name" hint="Nur zum Wiedererkennen, etwa „iPhone 15“.">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <div className="hint-box small">
            Das Token wird gleich <strong>einmal</strong> angezeigt. Danach ist es nicht
            mehr abrufbar – auch nicht für LifeHub. Wer es verliert, legt einen neuen
            Zugang an und widerruft den alten.
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------- Einmalige Anzeige */}
      {neuesToken && (
        <Modal open title="Dein Importtoken" onClose={() => setNeuesToken(null)}
          footer={<>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={() => setNeuesToken(null)}>
              Habe ich übertragen
            </button>
          </>}>
          <div className="hint-box crit small">
            <strong>Jetzt in den Kurzbefehl eintragen.</strong> Sobald dieses Fenster zu
            ist, gibt es das Token nirgends mehr.
          </div>
          <Field label="Token">
            <div className="row">
              <input className="input mono" readOnly value={neuesToken} style={{ flex: 1 }}
                onFocus={(e) => e.currentTarget.select()} />
              <button className="btn btn-sm" onClick={() => kopiere(neuesToken, 'token')}>
                {kopiert === 'token' ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
          </Field>
          <div className="small muted">
            Im Kurzbefehl kommt es in die Kopfzeile <span className="mono">Authorization</span> als
            {' '}<span className="mono">Bearer &lt;Token&gt;</span>.
          </div>
        </Modal>
      )}

      <Confirm open={!!widerrufen} title="Zugang widerrufen?"
        message="Der Kurzbefehl auf dem iPhone kann danach nichts mehr schicken. Bereits importierte Nächte bleiben erhalten."
        danger onCancel={() => setWiderrufen(null)}
        onConfirm={() => {
          m.patch('import_tokens', widerrufen.id, { revoked_at: new Date().toISOString() }, 'Zugang widerrufen')
          setWiderrufen(null)
        }} />
    </Card>
  )
}
