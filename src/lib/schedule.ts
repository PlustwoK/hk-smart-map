import { getLine, stationName } from '@/lib/network'

export type Arrival = {
  destination: string
  minutesLabel: string
  platform: string
  clock: string
}

export type LineSchedule = {
  line: string
  lineName: string
  color: string
  state: 'ready' | 'empty' | 'error'
  message?: string
  arrivals: Arrival[]
  delayed: boolean
  updatedAt?: string
}

type RawTrain = {
  seq?: string
  dest?: string
  plat?: string
  time?: string
  ttnt?: string
  valid?: string
}

function clockOf(time: string | undefined) {
  if (!time || time.length < 16) return ''
  return time.slice(11, 16)
}

function parseHongKongTimestamp(value: string | undefined) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

function minutesUntilLabel(arrivalTime: string | undefined, currentTime: string | undefined) {
  const arrival = parseHongKongTimestamp(arrivalTime)
  const current = parseHongKongTimestamp(currentTime)
  if (arrival == null || current == null) return '—'
  let diffMs = arrival - current
  if (diffMs < -18 * 60 * 60 * 1000) diffMs += 24 * 60 * 60 * 1000
  const minutes = Math.round(diffMs / 60_000)
  if (minutes <= 0) return '即將到站'
  return `${minutes} 分鐘`
}

function readArrivals(trains: unknown, currentTime: string | undefined): Arrival[] {
  if (!Array.isArray(trains)) return []
  return trains
    .filter((train): train is RawTrain => Boolean(train) && typeof train === 'object')
    .filter((train) => train.valid !== 'N' && train.dest)
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
    .map((train) => ({
      destination: stationName(train.dest ?? ''),
      minutesLabel: minutesUntilLabel(train.time, currentTime),
      platform: train.plat ? `${train.plat} 號月台` : '',
      clock: clockOf(train.time),
    }))
}

function emptyMessage(raw: string) {
  if (/empty/i.test(raw)) return '這個車站暫時沒有到站資料。'
  return '暫時取不到到站資料。'
}

export async function loadLineSchedule(line: string, station: string): Promise<LineSchedule> {
  const info = getLine(line)
  const base = {
    line,
    lineName: info?.name ?? line,
    color: info?.color ?? '#44403c',
    delayed: false,
    arrivals: [] as Arrival[],
  }
  try {
    const response = await fetch(
      `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`,
    )
    if (response.status === 429) {
      return { ...base, state: 'error', message: '查詢太頻密，請稍後再試。' }
    }
    if (!response.ok) {
      return { ...base, state: 'error', message: '暫時取不到到站資料。' }
    }
    const body = (await response.json()) as {
      status?: number | string
      message?: string
      isdelay?: string
      curr_time?: string
      data?: Record<string, { UP?: unknown; DOWN?: unknown; curr_time?: string }>
    }
    if (body.status === 0 || body.status === '0') {
      return { ...base, state: 'error', message: emptyMessage(String(body.message ?? '')) }
    }
    const block = body.data?.[`${line}-${station}`]
    const updatedAt = body.curr_time ?? block?.curr_time
    const delayed = body.isdelay === 'Y'
    const upListed = Array.isArray(block?.UP)
    const downListed = Array.isArray(block?.DOWN)
    if (!upListed && !downListed) {
      return { ...base, state: 'error', message: '暫時取不到到站資料。', delayed, updatedAt }
    }
    const up = readArrivals(upListed ? block?.UP : [], updatedAt)
    const down = readArrivals(downListed ? block?.DOWN : [], updatedAt)
    const arrivals = [...up, ...down]
    if (arrivals.length === 0) {
      return {
        ...base,
        state: 'empty',
        message: '現時沒有即將到站的班次。',
        delayed,
        updatedAt,
      }
    }
    const oneSideQuiet = upListed && downListed && (up.length === 0 || down.length === 0)
    return {
      ...base,
      state: 'ready',
      arrivals,
      delayed,
      updatedAt,
      message: oneSideQuiet ? '其中一個方向現時沒有班次。' : undefined,
    }
  } catch {
    return { ...base, state: 'error', message: '暫時取不到到站資料。' }
  }
}

export function loadStationSchedules(lines: string[], station: string) {
  return Promise.all(lines.map((line) => loadLineSchedule(line, station)))
}
