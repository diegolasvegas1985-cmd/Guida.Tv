# Canali Italia – Addon Stremio

Addon Stremio per la riproduzione dei canali TV italiani tramite playlist M3U.

## Struttura

- `server.js` – server e logica dell'addon Stremio.
- `package.json` – metadati, comando di avvio e dipendenze Node.js.
- `data/italy.m3u` – playlist dei canali.
- `docs/README.md` – documentazione del progetto.

## Avvio

Richiede Node.js.

```bash
npm install
npm start
```

Per Render, mantenere il comando di avvio `npm start`. Il server usa la porta
fornita dalla variabile d'ambiente `PORT` (con fallback locale a `7000`).

## Playlist

Per impostazione predefinita il server scarica la playlist da:

`https://raw.githubusercontent.com/diegolasvegas1985-cmd/Canali-Italia/refs/heads/main/data/italy.m3u`

È possibile sovrascrivere l'indirizzo impostando la variabile d'ambiente
`M3U_URL`.

## Aggiornare i canali

Modificare `data/italy.m3u` mantenendo il formato M3U e pubblicare le modifiche
sul branch `main`. Il server continuerà a leggere la playlist dall'indirizzo
predefinito indicato sopra.

## Note

La riorganizzazione non modifica i contenuti della playlist né la logica
dell'addon, salvo l'aggiornamento del percorso remoto della playlist.
