import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { TrafficCamera } from '@/lib/cameras'
import { getLine, type Station } from '@/lib/network'
import { loadStationSchedules, type LineSchedule } from '@/lib/schedule'

type DetailPanelProps = {
  station: Station | null
  camera: TrafficCamera | null
  onClose: () => void
}

export function DetailPanel({ station, camera, onClose }: DetailPanelProps) {
  if (!station && !camera) return null
  return (
    <section
      className="absolute inset-x-3 bottom-3 z-20 flex max-h-[48vh] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-xl md:inset-x-auto md:top-20 md:right-3 md:bottom-3 md:max-h-none md:w-[23rem]"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <p className="text-xs tracking-wide text-stone-500">{station ? '港鐵車站' : '交通快拍'}</p>
          <h2 className="text-xl font-semibold text-stone-900">
            {station ? station.nameZh : camera?.description}
          </h2>
          {station ? <p className="text-sm text-stone-500">{station.nameEn}</p> : null}
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          關閉
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
        {station ? <StationBody key={station.code} station={station} /> : null}
        {camera ? <CameraBody key={camera.key} camera={camera} /> : null}
      </ScrollArea>
    </section>
  )
}

function StationBody({ station }: { station: Station }) {
  const [schedules, setSchedules] = useState<LineSchedule[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadStationSchedules(station.lines, station.code).then((result) => {
      if (!cancelled) setSchedules(result)
    })
    return () => {
      cancelled = true
    }
  }, [station])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {station.lines.map((code) => {
          const line = getLine(code)
          return (
            <Badge key={code} variant="secondary" className="gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: line?.color }} />
              {line?.name ?? code}
            </Badge>
          )
        })}
      </div>
      {schedules === null ? <p className="text-sm text-stone-600">正在查詢到站班次…</p> : null}
      {schedules?.map((schedule) => (
        <div key={schedule.line} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: schedule.color }} />
            <h3 className="text-sm font-semibold">{schedule.lineName}</h3>
          </div>
          {schedule.delayed ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">港鐵表示有列車延誤。</p>
          ) : null}
          {schedule.state === 'error' || schedule.state === 'empty' ? (
            <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{schedule.message}</p>
          ) : null}
          {schedule.state === 'ready' ? (
            <ul className="flex flex-col gap-2">
              {schedule.arrivals.map((arrival, index) => (
                <li key={`${arrival.destination}-${arrival.clock}-${index}`} className="rounded-lg border border-stone-200 px-3 py-2">
                  <p className="font-medium text-stone-900">往{arrival.destination}</p>
                  <p className="text-sm text-stone-600">
                    {arrival.minutesLabel}
                    {arrival.platform ? ` · ${arrival.platform}` : ''}
                    {arrival.clock ? ` · ${arrival.clock}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {schedule.state === 'ready' && schedule.message ? (
            <p className="text-sm text-stone-600">{schedule.message}</p>
          ) : null}
          {schedule.updatedAt ? <p className="text-xs text-stone-400">資料時間 {schedule.updatedAt}</p> : null}
        </div>
      ))}
      <Separator />
      <p className="text-xs leading-5 text-stone-500">
        到站資料來自港鐵實時列車服務資訊，只在點選車站時查詢。路綫形狀來自 OpenStreetMap 的路軌。
      </p>
    </div>
  )
}

function CameraBody({ camera }: { camera: TrafficCamera }) {
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const src = nonce === 0 ? camera.url : `${camera.url}${camera.url.includes('?') ? '&' : '?'}_=${nonce}`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-600">
        {camera.region} · {camera.district}
      </p>
      {failed ? (
        <p className="rounded-lg bg-stone-100 px-3 py-3 text-sm text-stone-700">暫時未能提供照片。</p>
      ) : (
        <img
          src={src}
          alt={`${camera.description}的最新交通快拍`}
          width={320}
          height={240}
          className="w-full rounded-lg bg-stone-100"
          onError={() => setFailed(true)}
        />
      )}
      <p className="text-sm text-stone-600">
        若畫面顯示「暫時未能提供服務」，代表運輸署暫時沒有這張快拍。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          setFailed(false)
          setNonce(Date.now())
        }}
      >
        重新載入照片
      </Button>
      <Separator />
      <p className="text-xs leading-5 text-stone-500">相片約每兩分鐘更新，尺寸 320×240。資料來自運輸署交通情況快拍圖像。</p>
    </div>
  )
}
