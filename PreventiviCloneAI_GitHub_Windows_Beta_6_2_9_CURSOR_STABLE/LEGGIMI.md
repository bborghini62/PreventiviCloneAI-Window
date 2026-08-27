# Preventivi Clone AI Desktop 1.0 Beta 6.2.9 — Importazione ibrida veloce

Base stabile: Desktop Beta 6.2.6, con stampa ripristinata invariata.

## Novità
- **Veloce ibrida (predefinita):** legge testo e coordinate localmente in parallelo.
- Se il riconoscimento locale è affidabile, apre subito l’editor senza chiamare l’AI.
- Se il risultato è medio, invia all’AI solo il contesto testuale/strutturale già estratto.
- PDF scannerizzati o molto incerti passano automaticamente all’analisi visiva completa.
- **Accurata AI completa** e **Solo locale** sono selezionabili prima dell’importazione.
- Cache locale degli ultimi 12 PDF.

## Installazione macOS
Tasto destro su `BUILD_MAC.command` → Apri. La nuova app si trova in `src-tauri/target/release/bundle/macos/`.

## Ordine corretto
1. Aggiornare prima il Worker Cloudflare con il pacchetto Hybrid Speed.
2. Compilare e sostituire l’app desktop.

La stampa e il relativo audit sono quelli della base stabile 6.2.6.


## Beta 6.2.8 — Fix calcolo sottovoci
- Le sottovoci con prezzo 0 non azzerano più la voce principale.
- La voce principale passa alla somma delle sottovoci solo quando almeno una sottovoce contiene un prezzo/importo reale.
- Aggiungere una sottovoce vuota non disattiva più automaticamente il calcolo della voce principale.


## Beta 6.2.9 — Cursore e posizione stabili

Le correzioni di codice, quantità, prezzo, sconto e Calcola mantengono focus, cursore e posizione dell’elenco.

## GitHub Windows Beta 6.2.9

Il workflow `.github/workflows/build-windows.yml` prepara PDF.js e verifica sintassi, pulsanti, calcolo e stabilità del cursore prima della build NSIS Windows.
