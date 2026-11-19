Guida.Tv – Addon Stremio con EPG
Addon Stremio per i canali presenti nella playlist M3U, con recupero della programmazione XMLTV.
Configurazione predefinita
Playlist: repository GitHub Guida.Tv, file italy.m3u
EPG: epgshare01 Italia IT1 (epg_ripper_IT1.xml.gz)
Cache playlist: 10 minuti
Cache EPG: 30 minuti
Variabili facoltative:
M3U_URL: URL alternativo della playlist
EPG_URL: URL alternativo XMLTV/XMLTV.GZ
La corrispondenza primaria avviene tramite tvg-id esatto; è previsto un ripiego sul nome normalizzato esatto. I canali senza corrispondenza mostrano la guida come non disponibile, senza inventare programmi.
Render
Build Command: npm install Start Command: npm start Root Directory: vuoto
