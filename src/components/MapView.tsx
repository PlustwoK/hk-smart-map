import { useEffect, useRef } from 'react'
import { GeoJSONSource, Map, NavigationControl, Popup } from 'maplibre-gl'
import { cameraFeatures, type TrafficCamera } from '@/lib/cameras'
import { lineFeatures, stationFeatures } from '@/lib/network'
import { trainFeatures, type RunningTrain } from '@/lib/trains'

type Focus = { lon: number; lat: number; token: number }

type MapViewProps = {
  showMtr: boolean
  showCameras: boolean
  cameras: TrafficCamera[]
  trains: RunningTrain[]
  selectedStation: string | null
  panelOpen: boolean
  focus: Focus | null
  onSelectStation: (code: string) => void
  onSelectCamera: (key: string) => void
  onStyleFailure: () => void
}

const MTR_LAYERS = ['mtr-lines', 'stations', 'station-labels', 'train-points', 'train-labels']
const CAMERA_LAYERS = ['camera-clusters', 'camera-count', 'camera-points']

export function MapView({
  showMtr,
  showCameras,
  cameras,
  trains,
  selectedStation,
  panelOpen,
  focus,
  onSelectStation,
  onSelectCamera,
  onStyleFailure,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const layersReadyRef = useRef(false)
  const handlersRef = useRef({ onSelectStation, onSelectCamera, onStyleFailure, showMtr, showCameras })

  useEffect(() => {
    handlersRef.current = { onSelectStation, onSelectCamera, onStyleFailure, showMtr, showCameras }
  }, [onSelectStation, onSelectCamera, onStyleFailure, showMtr, showCameras])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [114.15, 22.35],
      zoom: 10.2,
      attributionControl: { compact: true },
      localIdeographFontFamily: '"Noto Sans TC", "PingFang TC", sans-serif',
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    let styleReady = false
    map.once('style.load', () => {
      styleReady = true
      const textFont = fontStack(map)
      map.addSource('mtr-lines', { type: 'geojson', data: lineFeatures() })
      map.addLayer({
        id: 'mtr-lines',
        type: 'line',
        source: 'mtr-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3.25,
          'line-opacity': 1,
        },
      })

      map.addSource('stations', { type: 'geojson', data: stationFeatures(), promoteId: 'code' })
      map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, 5.5],
          'circle-color': '#1c1917',
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 2],
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'station-labels',
        type: 'symbol',
        source: 'stations',
        minzoom: 12.5,
        layout: {
          'text-field': ['get', 'nameZh'],
          'text-font': textFont,
          'text-size': 12,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#1c1917',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      })

      map.addSource('cameras', {
        type: 'geojson',
        data: cameraFeatures([]),
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 13,
      })
      map.addLayer({
        id: 'camera-clusters',
        type: 'circle',
        source: 'cameras',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#c2410c',
          'circle-radius': ['step', ['get', 'point_count'], 13, 25, 17, 80, 22],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff7ed',
        },
      })
      map.addLayer({
        id: 'camera-count',
        type: 'symbol',
        source: 'cameras',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': textFont,
          'text-size': 11,
        },
        paint: { 'text-color': '#fff7ed' },
      })
      map.addLayer({
        id: 'camera-points',
        type: 'circle',
        source: 'cameras',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#c2410c',
          'circle-radius': 5,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addSource('trains', { type: 'geojson', data: trainFeatures([]) })
      map.addLayer({
        id: 'train-points',
        type: 'circle',
        source: 'trains',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 12, 11, 15, 16],
          'circle-color': '#ffffff',
          'circle-stroke-width': 4,
          'circle-stroke-color': ['get', 'color'],
        },
      })
      map.addLayer({
        id: 'train-labels',
        type: 'symbol',
        source: 'trains',
        minzoom: 13,
        layout: {
          'text-field': ['concat', '往', ['get', 'destination']],
          'text-font': textFont,
          'text-size': 11,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#1c1917',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      })

      map.on('click', (event) => {
        const { showMtr: mtrOn, showCameras: camerasOn, onSelectStation: pickStation, onSelectCamera: pickCamera } =
          handlersRef.current
        const layers = [
          ...(mtrOn ? ['train-labels', 'train-points', 'stations'] : []),
          ...(camerasOn ? ['camera-clusters', 'camera-points'] : []),
        ].filter((layer) => map.getLayer(layer))
        if (layers.length === 0) return
        const features = map.queryRenderedFeatures(event.point, { layers })
        const train = features.find((feature) => feature.layer.id === 'train-points' || feature.layer.id === 'train-labels')
        if (train?.geometry.type === 'Point') {
          const properties = train.properties ?? {}
          const content = document.createElement('div')
          content.style.fontSize = '14px'
          content.style.lineHeight = '1.45'
          const title = document.createElement('strong')
          title.textContent = `往${properties.destination ?? ''}`
          const detail = document.createElement('div')
          detail.textContent = `${properties.lineName ?? ''} · 下一站${properties.nextStation ?? ''} · ${properties.minutesLabel ?? ''}`
          content.append(title, detail)
          if (properties.delayed === 'Y') {
            const delay = document.createElement('div')
            delay.textContent = '此路綫有延誤'
            content.append(delay)
          }
          new Popup({ closeButton: true, offset: 10, maxWidth: '240px' })
            .setLngLat(train.geometry.coordinates as [number, number])
            .setDOMContent(content)
            .addTo(map)
          return
        }
        const station = features.find((feature) => feature.layer.id === 'stations')
        if (station && typeof station.properties?.code === 'string') {
          pickStation(station.properties.code)
          return
        }
        const cluster = features.find((feature) => feature.layer.id === 'camera-clusters')
        if (cluster?.geometry.type === 'Point') {
          const clusterId = Number(cluster.properties?.cluster_id)
          const coordinates = cluster.geometry.coordinates as [number, number]
          const source = map.getSource('cameras')
          if (Number.isFinite(clusterId) && source instanceof GeoJSONSource) {
            void source.getClusterExpansionZoom(clusterId).then((zoom) => {
              map.easeTo({ center: coordinates, zoom })
            })
          }
          return
        }
        const camera = features.find((feature) => feature.layer.id === 'camera-points')
        if (camera && typeof camera.properties?.key === 'string') pickCamera(camera.properties.key)
      })

      layersReadyRef.current = true

      map.on('mouseenter', 'stations', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'stations', () => {
        map.getCanvas().style.cursor = ''
      })
      for (const layer of ['camera-points', 'camera-clusters', 'train-points', 'train-labels']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }
    })

    const styleTimer = window.setTimeout(() => {
      if (!styleReady) handlersRef.current.onStyleFailure()
    }, 20000)

    return () => {
      window.clearTimeout(styleTimer)
      layersReadyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const source = map.getSource('cameras')
      if (source instanceof GeoJSONSource) source.setData(cameraFeatures(cameras))
    }
    return bindWhenReady(map, layersReadyRef, apply)
  }, [cameras])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let timer = 0
    const apply = () => {
      const source = map.getSource('trains')
      if (source instanceof GeoJSONSource) source.setData(trainFeatures(trains, Date.now()))
    }
    const cancel = bindWhenReady(map, layersReadyRef, () => {
      apply()
      timer = window.setInterval(apply, 1000)
    })
    return () => {
      cancel?.()
      window.clearInterval(timer)
    }
  }, [trains])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      for (const layer of MTR_LAYERS) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showMtr ? 'visible' : 'none')
      }
      for (const layer of CAMERA_LAYERS) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showCameras ? 'visible' : 'none')
      }
    }
    return bindWhenReady(map, layersReadyRef, apply)
  }, [showMtr, showCameras])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedStation) return
    const apply = () => {
      if (!map.getSource('stations')) return
      map.setFeatureState({ source: 'stations', id: selectedStation }, { selected: true })
    }
    const cancel = bindWhenReady(map, layersReadyRef, apply)
    return () => {
      cancel?.()
      if (map.getSource('stations')) map.removeFeatureState({ source: 'stations', id: selectedStation })
    }
  }, [selectedStation])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const wide = window.innerWidth >= 768
      map.setPadding({
        top: 88,
        left: 16,
        right: panelOpen && wide ? 390 : 16,
        bottom: panelOpen && !wide ? Math.round(window.innerHeight * 0.46) : 36,
      })
    }
    return bindWhenReady(map, layersReadyRef, apply)
  }, [panelOpen])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    const apply = () => {
      map.flyTo({
        center: [focus.lon, focus.lat],
        zoom: Math.max(map.getZoom(), 14),
        essential: true,
      })
    }
    return bindWhenReady(map, layersReadyRef, apply)
  }, [focus])

  return <div ref={containerRef} className="h-full w-full" />
}

function bindWhenReady(map: Map, ready: { current: boolean }, apply: () => void) {
  if (ready.current) {
    apply()
    return
  }
  map.once('load', apply)
  return () => {
    map.off('load', apply)
  }
}

function fontStack(map: Map): string[] {
  const style = map.getStyle()
  for (const layer of style?.layers ?? []) {
    if (layer.type !== 'symbol') continue
    const fonts = layer.layout?.['text-font']
    if (Array.isArray(fonts)) {
      const names = fonts.filter((font): font is string => typeof font === 'string')
      if (names.length > 0 && names.length === fonts.length) return names
    }
  }
  return ['Noto Sans Regular']
}
