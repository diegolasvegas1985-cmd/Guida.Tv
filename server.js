const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { gunzipSync } = require('zlib');

const M3U_URL = process.env.M3U_URL ||
    'https://raw.githubusercontent.com/diegolasvegas1985-cmd/Guida.Tv/refs/heads/main/italy.m3u';

const EPG_URL = process.env.EPG_URL ||
    'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz';

const BASE_ID = 'tv_italia_fast_container';
const FALLBACK_POSTER =
    'https://placehold.co/300x170/334155/ffffff/png?text=TV';

const CACHE_TTL = 10 * 60 * 1000;
const EPG_CACHE_TTL = 30 * 60 * 1000;

let channelsCache = { data: null, expires: 0 };
let epgCache = { data: null, expires: 0 };

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    processEntities: true
});

const builder = new addonBuilder({
    id: 'org.diegolasvegas.tvitalia.fast.color',
    version: '3.3.0',
    name: 'TV Italia Live - Guida TV',
    description: 'Canali TV italiani con programma in onda, prossimo programma e zapping rapido',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    catalogs: [{
        type: 'series',
        id: 'tv_italia_catalog_fast',
        name: 'Canali Italia - Guida TV'
    }]
});

function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function nodeText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object') return String(value['#text'] || '');
    return '';
}

function parseXmltvDate(value) {
    if (!value) return null;
    const match = String(value).match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/
    );
    if (!match) return null;

    const [, y, mo, d, h, mi, s, sign, offsetH, offsetM] = match;
    const utc = Date.UTC(
        Number(y), Number(mo) - 1, Number(d),
        Number(h), Number(mi), Number(s)
    );

    if (!sign) return new Date(utc);
    const offset = (Number(offsetH) * 60 + Number(offsetM)) * 60000;
    return new Date(utc - (sign === '+' ? offset : -offset));
}

function normalizeName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(hd|uhd|sd|tv|italia)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

async function parseM3U() {
    if (channelsCache.data && Date.now() < channelsCache.expires) {
        return channelsCache.data;
    }

    try {
        const response = await axios.get(M3U_URL, {
            timeout: 20000,
            responseType: 'text',
            maxContentLength: 5 * 1024 * 1024
        });

        const lines = String(response.data).split(/\r?\n/);
        const channels = [];
        let currentChannel = null;

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (line.startsWith('#EXTINF:')) {
                const nameMatch = line.match(/,(.+)$/);
                const idMatch = line.match(/tvg-id="([^"]*)"/);
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);

                currentChannel = {
                    name: nameMatch ? nameMatch[1].trim() : 'Canale TV',
                    tvgId: idMatch ? idMatch[1].trim() : '',
                    logo: logoMatch ? logoMatch[1] : ''
                };
            } else if (/^https?:\/\//i.test(line) && currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }

        channelsCache = {
            data: channels,
            expires: Date.now() + CACHE_TTL
        };
        return channels;
    } catch (error) {
        console.error('Errore download M3U:', error.message);
        return channelsCache.data || [];
    }
}

async function loadEpg() {
    if (epgCache.data && Date.now() < epgCache.expires) {
        return epgCache.data;
    }

    try {
        const response = await axios.get(EPG_URL, {
            timeout: 45000,
            responseType: 'arraybuffer',
            maxContentLength: 40 * 1024 * 1024
        });

        let buffer = Buffer.from(response.data);
        if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
            buffer = gunzipSync(buffer);
        }

        const xml = buffer.toString('utf8');
        const parsed = xmlParser.parse(xml);
        const tv = parsed.tv || {};
        const channelNodes = asArray(tv.channel);
        const programmeNodes = asArray(tv.programme);

        const channelNames = new Map();
        for (const item of channelNodes) {
            const id = item['@_id'];
            if (!id) continue;
            const displayNames = asArray(item['display-name'])
                .map(nodeText)
                .filter(Boolean);
            channelNames.set(id, displayNames);
        }

        const programmes = new Map();
        for (const item of programmeNodes) {
            const channelId = item['@_channel'];
            const start = parseXmltvDate(item['@_start']);
            const stop = parseXmltvDate(item['@_stop']);
            if (!channelId || !start || !stop) continue;

            const entry = {
                start,
                stop,
                title: nodeText(item.title),
                description: nodeText(item.desc)
            };
            if (!entry.title) continue;

            if (!programmes.has(channelId)) programmes.set(channelId, []);
            programmes.get(channelId).push(entry);
        }

        for (const list of programmes.values()) {
            list.sort((a, b) => a.start - b.start);
        }

        const data = { channelNames, programmes };
        epgCache = {
            data,
            expires: Date.now() + EPG_CACHE_TTL
        };

        console.log(
            `EPG caricata: ${channelNames.size} canali, ` +
            `${programmeNodes.length} programmi XMLTV`
        );
        return data;
    } catch (error) {
        console.error('Errore download/parsing EPG:', error.message);
        return epgCache.data || { channelNames: new Map(), programmes: new Map() };
    }
}

function findEpgId(channel, epg) {
    if (channel.tvgId && epg.programmes.has(channel.tvgId)) {
        return channel.tvgId;
    }

    // Ripiego prudente: corrispondenza esatta del nome normalizzato.
    // Non usa corrispondenze parziali per evitare di confondere canali simili.
    const wanted = normalizeName(channel.name);
    if (!wanted) return null;

    for (const [id, names] of epg.channelNames.entries()) {
        if (names.some(name => normalizeName(name) === wanted) &&
            epg.programmes.has(id)) {
            return id;
        }
    }
    return null;
}

function getNowAndNext(channel, epg, now = new Date()) {
    const epgId = findEpgId(channel, epg);
    if (!epgId) return { current: null, next: null };

    const list = epg.programmes.get(epgId) || [];
    const current = list.find(p => p.start <= now && p.stop > now) || null;
    const next = list.find(p => p.start > now) || null;
    return { current, next };
}

function formatTime(date) {
    return new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function programmeLine(label, programme) {
    if (!programme) return `${label}: non disponibile`;
    return `${label} ${formatTime(programme.start)}-${formatTime(programme.stop)}: ${programme.title}`;
}

function channelDescription(channel, epg) {
    const { current, next } = getNowAndNext(channel, epg);
    const lines = [
        'TV Italia Live - Zapping rapido',
        programmeLine('IN ONDA', current),
        programmeLine('A SEGUIRE', next)
    ];
    if (current && current.description) {
        lines.push('', current.description);
    }
    return lines.join('\n');
}

// CATALOGO: una scheda per ogni canale, con il programma in onda.
builder.defineCatalogHandler(async (args) => {
    if (args.type === 'series' && args.id === 'tv_italia_catalog_fast') {
        const [channels, epg] = await Promise.all([parseM3U(), loadEpg()]);
        const matchedCount = channels.filter(ch => findEpgId(ch, epg)).length;
        console.log(`EPG collegata a ${matchedCount}/${channels.length} canali della playlist`);

        return {
            metas: channels.map((ch, index) => ({
                id: `${BASE_ID}:${index + 1}`,
                type: 'series',
                name: ch.name,
                poster: ch.logo || FALLBACK_POSTER,
                posterShape: 'landscape',
                description: channelDescription(ch, epg)
            }))
        };
    }
    return { metas: [] };
});

// DETTAGLIO: il canale selezionato resta il primo; gli altri servono per lo zapping.
builder.defineMetaHandler(async (args) => {
    if (args.type === 'series' && args.id.startsWith(BASE_ID + ':')) {
        const [channels, epg] = await Promise.all([parseM3U(), loadEpg()]);
        const selectedIndex = parseInt(args.id.split(':')[1], 10) - 1;

        if (selectedIndex < 0 || selectedIndex >= channels.length) {
            return { meta: null };
        }

        const orderedChannels = [
            channels[selectedIndex],
            ...channels.filter((_, i) => i !== selectedIndex)
        ];

        const videos = orderedChannels.map((ch, order) => {
            const originalIndex = channels.indexOf(ch);
            const number = String(originalIndex + 1).padStart(2, '0');
            const { current } = getNowAndNext(ch, epg);
            const suffix = current ? ` | ${current.title}` : '';

            return {
                id: `${args.id}:1:${originalIndex + 1}`,
                title: `${number} - ${ch.name}${suffix}`,
                released: new Date().toISOString(),
                season: 1,
                episode: order + 1,
                thumbnail: ch.logo || FALLBACK_POSTER,
                overview: channelDescription(ch, epg)
            };
        });

        return {
            meta: {
                id: args.id,
                type: 'series',
                name: channels[selectedIndex].name,
                poster: channels[selectedIndex].logo || FALLBACK_POSTER,
                description: channelDescription(channels[selectedIndex], epg) +
                    '\n\nSeleziona un canale e usa il menu laterale del player per fare zapping.',
                videos
            }
        };
    }
    return { meta: null };
});

// STREAM: URL e comportamento di zapping restano invariati.
builder.defineStreamHandler(async (args) => {
    if (args.type === 'series') {
        const parts = args.id.split(':');
        if (parts.length === 4 && parts[0] === BASE_ID) {
            const channelIndex = parseInt(parts[3], 10) - 1;
            const channels = await parseM3U();
            const channel = channels[channelIndex];

            if (channel) {
                return {
                    streams: [{
                        title: `Diretta - ${channel.name}`,
                        url: channel.url,
                        behaviorHints: { notWebReady: true }
                    }]
                };
            }
        }
    }
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
                                                       
