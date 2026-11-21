import { useEffect, useMemo, useState } from 'react'
import { DetailPanel } from '@/components/DetailPanel'
import { MapView } from '@/components/MapView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadCameras, type TrafficCamera } from '@/lib/cameras'
import { lines, stations, type Station } from '@/lib/network'
import { loadRunningTrains, type Fleet } from '@/lib/trains'

type Focus = { lon: number; lat: number; token: number }

export default function App() {
  const [showMtr, setShowMtr] = useState(true)
  const [showCameras, setShowCameras] = useState(true)
  const [cameras, setCameras] = useState<TrafficCamera[]>([])
  const [cameraState, setCameraState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [styleFailed, setStyleFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedStation, setSelectedStation] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [fleet, setFleet] = useState<Fleet>({ state: 'ready', trains: [], delayed: false })
  const [trainsLoading, setTrainsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void loadCameras()
      .then((list) => {
        if (cancelled) return
        setCameras(list)
        setCameraState('ready')
      })
      .catch(() => {
        if (!cancelled) setCameraState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showMtr) return
    let cancelled = false
    let timer = 0
    const run = () => {
      void loadRunningTrains().then((next) => {
        if (cancelled) return
        setFleet(next)
        setTrainsLoading(false)
        timer = window.setTimeout(run, next.state === 'error' && next.message?.includes('頻密') ? 60_000 : 30_000)
      })
    }
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [showMtr])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedStation(null)
        setSelectedCamera(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const station = stations.find((item) => item.code === selectedStation) ?? null
  const camera = cameras.find((item) => item.key === selectedCamera) ?? null
  const results = useMemo(() => search(query, cameras), [query, cameras])

  function chooseStation(code: string) {
    const next = stations.find((item) => item.code === code)
    if (!next) return
    setSelectedCamera(null)
    setSelectedStation(code)
    setFocus({ lon: next.lon, lat: next.lat, token: Date.now() })
    setQuery('')
  }

  function chooseCamera(key: string) {
    const next = cameras.find((item) => item.key === key)
    if (!next) return
    setSelectedStation(null)
    setSelectedCamera(key)
    setShowCameras(true)
    setFocus({ lon: next.lon, lat: next.lat, token: Date.now() })
    setQuery('')
  }

  return (
    <main className="relative h-full overflow-hidden bg-stone-100 text-stone-900">
      {styleFailed ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-lg">
            <h1 className="text-xl font-semibold">地圖暫時載入不到</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              底圖來自 OpenFreeMap。現在連不上公開圖磚，請檢查網絡後再重新整理。
            </p>
          </div>
        </div>
      ) : (
        <MapView
          showMtr={showMtr}
          showCameras={showCameras}
          cameras={cameras}
          trains={showMtr ? fleet.trains : []}
          selectedStation={selectedStation}
          panelOpen={Boolean(station || camera)}
          focus={focus}
          onSelectStation={chooseStation}
          onSelectCamera={chooseCamera}
          onStyleFailure={() => setStyleFailed(true)}
        />
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="pointer-events-auto rounded-2xl bg-white/95 px-3 py-2 shadow-md">
            <p className="text-[11px] tracking-wide text-stone-500">香港</p>
            <h1 className="text-base font-semibold leading-5">智慧城市地圖</h1>
            <p className="text-[10px] text-stone-400">OpenFreeMap © OpenMapTiles · OpenStreetMap</p>
          </div>
          <div className="pointer-events-auto flex gap-1.5">
            <Button
              variant={showMtr ? 'default' : 'outline'}
              aria-pressed={showMtr}
              onClick={() => setShowMtr((value) => !value)}
            >
              港鐵
            </Button>
            <Button
              variant={showCameras ? 'default' : 'outline'}
              aria-pressed={showCameras}
              onClick={() => setShowCameras((value) => !value)}
            >
              交通快拍
            </Button>
          </div>
          <div className="pointer-events-auto relative min-w-56 flex-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋車站或快拍地點"
              aria-label="搜尋車站或快拍地點"
              className="h-9 bg-white/95 shadow-md"
            />
            {results.length > 0 ? (
              <ul className="absolute mt-1 max-h-72 w-full overflow-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50"
                      onClick={() =>
                        result.kind === 'station' ? chooseStation(result.code) : chooseCamera(result.key)
                      }
                    >
                      <span>{result.label}</span>
                      <Badge variant="secondary">{result.kind === 'station' ? '車站' : '快拍'}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {cameraState === 'loading' ? (
          <p className="pointer-events-auto w-fit rounded-full bg-white/95 px-3 py-1 text-xs text-stone-600 shadow">
            正在載入交通快拍位置…
          </p>
        ) : null}
        {cameraState === 'error' ? (
          <p className="pointer-events-auto max-w-lg rounded-xl bg-white px-3 py-2 text-sm text-stone-700 shadow">
            暫時取不到交通快拍位置，地圖上不會顯示快拍點。
          </p>
        ) : null}
        {cameraState === 'ready' ? (
          <p className="pointer-events-auto w-fit rounded-full bg-white/90 px-3 py-1 text-xs text-stone-500 shadow">
            {cameras.length} 個快拍點。縮小地圖時會合成一組。
          </p>
        ) : null}
        {showMtr && trainsLoading ? (
          <p className="pointer-events-auto w-fit rounded-full bg-white/95 px-3 py-1 text-xs text-stone-600 shadow">
            正在查列車位置…
          </p>
        ) : null}
        {showMtr && !trainsLoading && fleet.state === 'ready' ? (
          <p className="pointer-events-auto w-fit rounded-full bg-white/95 px-3 py-1 text-xs text-stone-600 shadow">
            {fleet.trains.length} 班行駛中，位置按到站時間估算。
            {fleet.delayed ? ' 部分路綫有延誤。' : ''}
            {fleet.message ? ` ${fleet.message}` : ''}
          </p>
        ) : null}
        {showMtr && !trainsLoading && fleet.state !== 'ready' ? (
          <p className="pointer-events-auto max-w-lg rounded-xl bg-white px-3 py-2 text-sm text-stone-700 shadow">
            {fleet.message}
          </p>
        ) : null}
      </header>

      {!station && !camera && !styleFailed ? <Legend /> : null}
      <DetailPanel
        station={station}
        camera={camera}
        onClose={() => {
          setSelectedStation(null)
          setSelectedCamera(null)
        }}
      />
    </main>
  )
}

function Legend() {
  return (
    <aside className="absolute bottom-8 left-3 z-10 hidden max-w-xs rounded-2xl bg-white/95 p-3 shadow-md md:block">
      <p className="mb-2 text-xs font-medium text-stone-500">港鐵路綫</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {lines.map((line) => (
          <li key={line.code} className="flex items-center gap-1.5 text-xs text-stone-700">
            <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: line.color }} />
            {line.name}
          </li>
        ))}
      </ul>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              彩色圓點是行駛中的列車。點車站查看到站班次，點橙色點查看最新照片。
            </p>
    </aside>
  )
}

type SearchHit =
  | { id: string; kind: 'station'; code: string; label: string }
  | { id: string; kind: 'camera'; key: string; label: string }

function search(query: string, cameras: TrafficCamera[]): SearchHit[] {
  const text = query.trim().toLowerCase()
  if (!text) return []
  const stationHits: SearchHit[] = stations
    .filter((station) => matchesStation(station, text))
    .slice(0, 6)
    .map((station) => ({
      id: `s-${station.code}`,
      kind: 'station',
      code: station.code,
      label: station.nameZh,
    }))
  const cameraHits: SearchHit[] =
    text.length < 2
      ? []
      : cameras
          .filter((camera) =>
            `${camera.description} ${camera.district} ${camera.region}`.toLowerCase().includes(text),
          )
          .slice(0, 5)
          .map((camera) => ({
            id: `c-${camera.key}`,
            kind: 'camera',
            key: camera.key,
            label: camera.description,
          }))
  return [...stationHits, ...cameraHits]
}

function matchesStation(station: Station, text: string) {
  return station.nameZh.toLowerCase().includes(text) || station.nameEn.toLowerCase().includes(text)
}
