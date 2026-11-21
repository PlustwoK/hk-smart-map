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

function readArrivals(trains: unknown): Arrival[] {
  if (!Array.isArray(trains)) return []
  return trains
    .filter((train): train is RawTrain => Boolean(train) && typeof train === 'object')
    .filter((train) => train.valid !== 'N' && train.dest)
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
    .map((train) => ({
      destination: stationName(train.dest ?? ''),
      minutesLabel: train.ttnt === '0' ? '即將到站' : `${train.ttnt ?? '—'} 分鐘`,
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
      data?: Record<string, { UP?: unknown; DOWN?: unknown }>
    }
    if (body.status === 0 || body.status === '0') {
      return { ...base, state: 'error', message: emptyMessage(String(body.message ?? '')) }
    }
    const block = body.data?.[`${line}-${station}`]
    const up = readArrivals(block?.UP)
    const down = readArrivals(block?.DOWN)
    const arrivals = [...up, ...down]
    const delayed = body.isdelay === 'Y'
    const updatedAt = body.curr_time
    if (arrivals.length === 0) {
      return {
        ...base,
        state: 'empty',
        message: '現時沒有即將到站的班次。',
        delayed,
        updatedAt,
      }
    }
    const oneSideQuiet = up.length === 0 || down.length === 0
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
