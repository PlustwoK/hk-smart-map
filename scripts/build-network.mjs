import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LINES = [
  { code: 'AEL', name: '機場快綫', color: '#1c7670' },
  { code: 'TCL', name: '東涌綫', color: '#f7941d' },
  { code: 'TML', name: '屯馬綫', color: '#9a3b26' },
  { code: 'TKL', name: '將軍澳綫', color: '#6b208b' },
  { code: 'EAL', name: '東鐵綫', color: '#53b7e8' },
  { code: 'SIL', name: '南港島綫', color: '#b5bd00' },
  { code: 'TWL', name: '荃灣綫', color: '#e2231a' },
  { code: 'ISL', name: '港島綫', color: '#007dc5' },
  { code: 'KTL', name: '觀塘綫', color: '#00a651' },
  { code: 'DRL', name: '迪士尼綫', color: '#f26eb4' },
]

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function normZh(value) {
  return value.normalize('NFC').replaceAll('荔', '茘').replace(/\s+/g, '').replace(/站$/u, '')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const [header, ...body] = rows
  return body
    .filter((columns) => columns.some((column) => column.trim()))
    .map((columns) => {
      const record = {}
      header.forEach((key, index) => {
        record[key.trim()] = (columns[index] ?? '').trim()
      })
      return record
    })
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'hk-smart-map/0.1 (classroom map; station geometry build)' },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

async function overpass(query) {
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ]
  let lastError
  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        console.log(`overpass ${endpoint} attempt ${attempt}`)
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'User-Agent': 'hk-smart-map/0.1 (classroom map; station geometry build)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(50000),
        })
        if (!response.ok) throw new Error(`${response.status} ${endpoint}`)
        return await response.json()
      } catch (error) {
        lastError = error
        console.log(`overpass failed: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  }
  throw lastError
}

function distanceMeters(a, b) {
  const earth = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(h))
}

function representative(points) {
  const nodes = points.filter((point) => point.type === 'node')
  const pool = nodes.length > 0 ? nodes : points
  const withRef = pool.filter((point) => point.ref)
  const chosen = (withRef.length > 0 ? withRef : pool)[0]
  return chosen
}

const csv = parseCsv(
  await fetchText('https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv'),
)

const records = csv
  .map((row) => ({
    line: row['Line Code'],
    direction: row.Direction,
    code: row['Station Code'],
    nameZh: row['Chinese Name'],
    nameEn: row['English Name'],
    sequence: row.Sequence ? Number(row.Sequence) : null,
  }))
  .filter((row) => row.line && row.code && row.sequence !== null)

const byCode = new Map()
for (const record of records) {
  const current = byCode.get(record.code) ?? {
    code: record.code,
    nameZh: record.nameZh,
    nameEn: record.nameEn,
    lines: new Set(),
  }
  current.lines.add(record.line)
  byCode.set(record.code, current)
}
byCode.set('RAC', {
  code: 'RAC',
  nameZh: '馬場',
  nameEn: 'Racecourse',
  lines: new Set(['EAL']),
})

const query = `
[out:json][timeout:90];
(
  node["railway"="station"]["station"~"^(subway|train)$"](22.15,113.82,22.56,114.44);
  way["railway"="station"]["station"~"^(subway|train)$"](22.15,113.82,22.56,114.44);
  relation["railway"="station"]["station"~"^(subway|train)$"](22.15,113.82,22.56,114.44);
);
out center;
`
const osm = await overpass(query)
const places = []
for (const element of osm.elements ?? []) {
  const tags = element.tags ?? {}
  const operator = `${tags.operator ?? ''} ${tags.network ?? ''}`
  if (operator.includes('深圳')) continue
  const center = element.center ?? element
  if (typeof center.lat !== 'number' || typeof center.lon !== 'number') continue
  const nameZh = (tags['name:zh'] || tags.name || '').trim()
  if (!nameZh) continue
  places.push({
    type: element.type,
    nameZh,
    nameEn: (tags['name:en'] || '').trim(),
    ref: (tags.ref || tags['ref:mtr'] || '').trim().toUpperCase(),
    lat: center.lat,
    lon: center.lon,
  })
}

const byName = new Map()
for (const place of places) {
  const key = normZh(place.nameZh)
  const list = byName.get(key) ?? []
  list.push(place)
  byName.set(key, list)
}

function clustersOf(points) {
  const remaining = [...points]
  const clusters = []
  while (remaining.length > 0) {
    const seed = remaining.shift()
    const cluster = [seed]
    for (let index = 0; index < remaining.length; ) {
      if (cluster.some((point) => distanceMeters(point, remaining[index]) < 120)) {
        cluster.push(remaining.splice(index, 1)[0])
      } else {
        index += 1
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

const unresolved = []
const chosen = new Map()

for (const station of byCode.values()) {
  const points = byName.get(normZh(station.nameZh)) ?? []
  const clusters = clustersOf(points)
  if (clusters.length === 1) {
    chosen.set(station.code, representative(clusters[0]))
  } else {
    unresolved.push({ station, clusters })
  }
}

for (const item of unresolved) {
  const refClusters = item.clusters.filter((cluster) =>
    cluster.some((entry) => entry.ref === item.station.code),
  )
  const pool = refClusters.length > 0 ? refClusters : item.clusters
  if (refClusters.length > 1) {
    const points = pool.map((cluster) => representative(cluster))
    const averaged = {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    }
    console.log(
      `averaged ${item.station.code} ${item.station.nameZh} from ${points.length} ref matches -> ${averaged.lat.toFixed(5)},${averaged.lon.toFixed(5)}`,
    )
    chosen.set(item.station.code, averaged)
    continue
  }
  const lineMates = [...byCode.values()].filter(
    (station) =>
      station.code !== item.station.code &&
      chosen.has(station.code) &&
      [...station.lines].some((line) => item.station.lines.has(line)),
  )
  let best = null
  let bestScore = Infinity
  for (const cluster of pool) {
    const point = representative(cluster)
    const score =
      lineMates.length === 0
        ? 0
        : Math.min(...lineMates.map((mate) => distanceMeters(point, chosen.get(mate.code))))
    if (score < bestScore) {
      bestScore = score
      best = point
    }
  }
  if (best) {
    console.log(
      `picked ${item.station.code} ${item.station.nameZh} from ${item.clusters.length} clusters -> ${best.lat.toFixed(5)},${best.lon.toFixed(5)}`,
    )
    chosen.set(item.station.code, best)
  }
}

const missing = [...byCode.keys()].filter((code) => !chosen.has(code))
if (missing.length > 0) {
  console.error('missing coordinates', missing)
  process.exit(1)
}

function ordered(line, direction) {
  return records
    .filter((record) => record.line === line && record.direction === direction)
    .sort((a, b) => a.sequence - b.sequence)
    .map((record) => record.code)
}

const segments = []
const seenSegments = new Set()
function addSegment(line, from, to) {
  if (!from || !to || from === to) return
  const key = `${line}:${from}>${to}`
  if (seenSegments.has(key)) return
  seenSegments.add(key)
  segments.push({ line, from, to })
}

for (const line of LINES) {
  const main = ordered(line.code, 'DT')
  for (let index = 1; index < main.length; index += 1) {
    addSegment(line.code, main[index - 1], main[index])
  }
  const mainSet = new Set(main)
  const branchDirections = [
    ...new Set(records.filter((record) => record.line === line.code).map((record) => record.direction)),
  ].filter((direction) => direction.endsWith('-DT'))
  for (const direction of branchDirections) {
    const sequence = ordered(line.code, direction)
    for (let index = 1; index < sequence.length; index += 1) {
      const from = sequence[index - 1]
      const to = sequence[index]
      if (!mainSet.has(from) || !mainSet.has(to)) addSegment(line.code, from, to)
    }
  }
}

const university = chosen.get('UNI')
const foTan = chosen.get('FOT')
const racecourse = chosen.get('RAC')
const racecourseLink =
  distanceMeters(racecourse, university) <= distanceMeters(racecourse, foTan) ? 'UNI' : 'FOT'
addSegment('EAL', racecourseLink, 'RAC')
console.log(`racecourse spur from ${racecourseLink}`)

const stations = [...byCode.values()]
  .map((station) => {
    const point = chosen.get(station.code)
    return {
      code: station.code,
      nameZh: station.nameZh,
      nameEn: station.nameEn,
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
      lines: LINES.map((line) => line.code).filter((code) => station.lines.has(code)),
    }
  })
  .sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh-Hant'))

for (const segment of segments) {
  if (!byCode.has(segment.from) || !byCode.has(segment.to)) {
    throw new Error(`bad segment ${segment.line} ${segment.from}-${segment.to}`)
  }
}

const network = {
  source:
    '車站名稱與行車次序來自港鐵公開資料 mtr_lines_and_stations.csv。馬場站名稱來自到站接口說明。座標來自 OpenStreetMap。',
  lines: LINES,
  stations,
  segments,
}

const target = join(root, 'src/data/network.json')
writeFileSync(target, `${JSON.stringify(network, null, 2)}\n`)
console.log(`wrote ${stations.length} stations, ${segments.length} segments`)
