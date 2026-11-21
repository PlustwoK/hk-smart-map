import { getLine, getStation, segments, stationName, tracks } from '@/lib/network'
import { minutesUntil } from '@/lib/schedule'

export type RunningTrain = {
  id: string
  line: string
  lineName: string
  color: string
  destination: string
  nextStation: string
  minutesLabel: string
  lon: number
  lat: number
  delayed: boolean
}

export type Fleet = {
  state: 'ready' | 'empty' | 'error'
  trains: RunningTrain[]
  delayed: boolean
  message?: string
}

type Hit = {
  line: string
  station: string
  dest: string
  etaMs: number
  minutes: number
  delayed: boolean
}

type RawTrain = {
  seq?: string
  dest?: string
  time?: string
  valid?: string
}

const neighbors = new Map<string, Map<string, string[]>>()
for (const segment of segments) {
  const line = neighbors.get(segment.line) ?? new Map<string, string[]>()
  const from = line.get(segment.from) ?? []
  const to = line.get(segment.to) ?? []
  if (!from.includes(segment.to)) from.push(segment.to)
  if (!to.includes(segment.from)) to.push(segment.from)
  line.set(segment.from, from)
  line.set(segment.to, to)
  neighbors.set(segment.line, line)
}

function path(line: string, from: string, to: string) {
  if (from === to) return [from]
  const graph = neighbors.get(line)
  if (!graph) return null
  const previous = new Map<string, string | null>([[from, null]])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    for (const next of graph.get(current) ?? []) {
      if (previous.has(next)) continue
      previous.set(next, current)
      if (next === to) {
        const route = [to]
        let cursor: string | null = current
        while (cursor) {
          route.push(cursor)
          cursor = previous.get(cursor) ?? null
        }
        return route.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

function previousStation(line: string, station: string, dest: string) {
  const route = path(line, station, dest)
  const adjacent = neighbors.get(line)?.get(station) ?? []
  if (route && route.length > 1) {
    const ahead = new Set(route.slice(1))
    return adjacent.find((code) => !ahead.has(code)) ?? null
  }
  return adjacent[0] ?? null
}

function meters(a: [number, number], b: [number, number]) {
  const lat = ((a[1] + b[1]) * Math.PI) / 360
  return Math.hypot((a[0] - b[0]) * Math.cos(lat) * 111320, (a[1] - b[1]) * 110540)
}

const projection = new Map<string, { track: number; index: number } | null>()

function projectionOf(line: string, code: string) {
  const key = `${line}:${code}`
  if (projection.has(key)) return projection.get(key) ?? null
  const station = getStation(code)
  if (!station) {
    projection.set(key, null)
    return null
  }
  let bestTrack = -1
  let bestIndex = 0
  let bestDistance = Infinity
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]
    if (track.line !== line) continue
    for (let index = 0; index < track.coordinates.length; index += 1) {
      const point = track.coordinates[index]
      const distance = meters([station.lon, station.lat], [point[0], point[1]])
      if (distance < bestDistance) {
        bestDistance = distance
        bestTrack = trackIndex
        bestIndex = index
      }
    }
  }
  const value = bestTrack >= 0 && bestDistance <= 700 ? { track: bestTrack, index: bestIndex } : null
  projection.set(key, value)
  return value
}

function pointAtFraction(coords: [number, number][], fraction: number) {
  const lengths = [0]
  for (let index = 1; index < coords.length; index += 1) {
    lengths.push(lengths[index - 1] + meters(coords[index - 1], coords[index]))
  }
  const total = lengths[lengths.length - 1]
  const target = total * fraction
  if (total === 0) return { lon: coords[0][0], lat: coords[0][1] }
  for (let index = 1; index < coords.length; index += 1) {
    if (lengths[index] < target) continue
    const span = lengths[index] - lengths[index - 1]
    const ratio = span === 0 ? 0 : (target - lengths[index - 1]) / span
    return {
      lon: coords[index - 1][0] + (coords[index][0] - coords[index - 1][0]) * ratio,
      lat: coords[index - 1][1] + (coords[index][1] - coords[index - 1][1]) * ratio,
    }
  }
  const last = coords[coords.length - 1]
  return { lon: last[0], lat: last[1] }
}

function place(line: string, from: string, to: string, fraction: number) {
  const start = getStation(from)
  const end = getStation(to)
  if (!start || !end) return null
  const projectedStart = projectionOf(line, from)
  const projectedEnd = projectionOf(line, to)
  let coords: [number, number][]
  if (
    projectedStart &&
    projectedEnd &&
    projectedStart.track === projectedEnd.track &&
    projectedStart.index !== projectedEnd.index
  ) {
    const track = tracks[projectedStart.track].coordinates
    coords = (
      projectedStart.index < projectedEnd.index
        ? track.slice(projectedStart.index, projectedEnd.index + 1)
        : track.slice(projectedEnd.index, projectedStart.index + 1).reverse()
    ) as [number, number][]
  } else {
    coords = [
      [start.lon, start.lat],
      [end.lon, end.lat],
    ]
  }
  return pointAtFraction(coords, fraction)
}

function firstTrain(trains: unknown, currentMs: number, now: string | undefined) {
  if (!Array.isArray(trains)) return null
  const valid = trains
    .filter((train): train is RawTrain => Boolean(train) && typeof train === 'object')
    .filter((train) => train.valid !== 'N' && train.dest)
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
  const train = valid[0]
  if (!train?.time) return null
  const minutes = minutesUntil(train.time, now)
  if (minutes == null || minutes > 20) return null
  const eta = currentMs + minutes * 60_000
  return { dest: train.dest as string, eta, minutes }
}

async function fetchStation(line: string, station: string) {
  const response = await fetch(
    `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`,
  )
  if (response.status === 429) return { kind: 'rate' as const }
  if (!response.ok) return { kind: 'error' as const }
  const body = (await response.json()) as {
    status?: number | string
    isdelay?: string
    curr_time?: string
    data?: Record<string, { UP?: unknown; DOWN?: unknown; curr_time?: string }>
  }
  if (body.status === 0 || body.status === '0') return { kind: 'empty' as const }
  const block = body.data?.[`${line}-${station}`]
  const now = body.curr_time ?? block?.curr_time
  const currentMs = now ? Date.parse(now.replace(' ', 'T') + '+08:00') : Date.now()
  const delayed = body.isdelay === 'Y'
  const hits: Hit[] = []
  for (const list of [block?.UP, block?.DOWN]) {
    const train = firstTrain(list, Number.isFinite(currentMs) ? currentMs : Date.now(), now)
    if (!train) continue
    hits.push({ line, station, dest: train.dest, etaMs: train.eta, minutes: train.minutes, delayed })
  }
  return { kind: 'ok' as const, hits }
}

async function fetchAll() {
  const jobs = stationsOnLines()
  const hits: Hit[] = []
  let rate = 0
  let failed = 0
  let ok = 0
  let cursor = 0
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor]
      cursor += 1
      const result = await fetchStation(job.line, job.station)
      if (result.kind === 'rate') rate += 1
      else if (result.kind === 'error') failed += 1
      else if (result.kind === 'ok') {
        ok += 1
        hits.push(...result.hits)
      } else ok += 1
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  return { hits, rate, failed, ok }
}

function stationsOnLines() {
  const jobs: { line: string; station: string }[] = []
  for (const station of getStationList()) {
    for (const line of station.lines) jobs.push({ line, station: station.code })
  }
  return jobs
}

function getStationList() {
  return [...new Set(segments.flatMap((segment) => [segment.from, segment.to]))]
    .map((code) => getStation(code))
    .filter((station): station is NonNullable<ReturnType<typeof getStation>> => Boolean(station))
}

function dedupe(hits: Hit[]) {
  const accepted: Hit[] = []
  for (const hit of [...hits].sort((a, b) => a.etaMs - b.etaMs)) {
    const duplicate = accepted.some((kept) => {
      if (kept.line !== hit.line || kept.dest !== hit.dest) return false
      if (kept.station === hit.station) return true
      const route = path(hit.line, kept.station, hit.dest)
      if (!route) return false
      const hops = route.indexOf(hit.station)
      if (hops <= 0) return false
      const gap = (hit.etaMs - kept.etaMs) / 60_000
      return gap >= -0.5 && gap <= hops * 7 + 1
    })
    if (!duplicate) accepted.push(hit)
  }
  return accepted
}

function toTrain(hit: Hit): RunningTrain | null {
  const info = getLine(hit.line)
  const previous = previousStation(hit.line, hit.station, hit.dest)
  const fraction = Math.min(0.94, Math.max(0.08, 1 - Math.max(hit.minutes, 0) / 3.5))
  const point = previous
    ? place(hit.line, previous, hit.station, fraction)
    : (() => {
        const station = getStation(hit.station)
        return station ? { lon: station.lon, lat: station.lat } : null
      })()
  if (!point) return null
  return {
    id: `${hit.line}-${hit.station}-${hit.dest}-${hit.etaMs}`,
    line: hit.line,
    lineName: info?.name ?? hit.line,
    color: info?.color ?? '#44403c',
    destination: stationName(hit.dest),
    nextStation: stationName(hit.station),
    minutesLabel: hit.minutes <= 0 ? '即將到站' : `${hit.minutes} 分鐘`,
    lon: point.lon,
    lat: point.lat,
    delayed: hit.delayed,
  }
}

export function trainFeatures(trains: RunningTrain[]) {
  return {
    type: 'FeatureCollection' as const,
    features: trains.map((train) => ({
      type: 'Feature' as const,
      properties: {
        id: train.id,
        color: train.color,
        lineName: train.lineName,
        destination: train.destination,
        nextStation: train.nextStation,
        minutesLabel: train.minutesLabel,
        delayed: train.delayed ? 'Y' : 'N',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [train.lon, train.lat],
      },
    })),
  }
}

export async function loadRunningTrains(): Promise<Fleet> {
  try {
    const { hits, rate, failed, ok } = await fetchAll()
    if (ok === 0) {
      return {
        state: 'error',
        trains: [],
        delayed: false,
        message: rate > failed ? '查詢太頻密，請稍後再看列車位置。' : '暫時取不到列車位置。',
      }
    }
    const trains = dedupe(hits).flatMap((hit) => {
      const train = toTrain(hit)
      return train ? [train] : []
    })
    if (trains.length === 0) {
      return { state: 'empty', trains: [], delayed: false, message: '現時沒有行駛中的列車。' }
    }
    return {
      state: 'ready',
      trains,
      delayed: trains.some((train) => train.delayed),
      message: rate > 0 ? '部分車站未更新。' : undefined,
    }
  } catch {
    return { state: 'error', trains: [], delayed: false, message: '暫時取不到列車位置。' }
  }
}
