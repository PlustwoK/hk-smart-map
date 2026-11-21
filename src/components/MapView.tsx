import { useEffect, useRef } from 'react'
import { GeoJSONSource, Map, NavigationControl } from 'maplibre-gl'
import { cameraFeatures, type TrafficCamera } from '@/lib/cameras'
import { lineFeatures, stationFeatures } from '@/lib/network'

type Focus = { lon: number; lat: number; token: number }

type MapViewProps = {
  showMtr: boolean
  showCameras: boolean
  cameras: TrafficCamera[]
  selectedStation: string | null
  panelOpen: boolean
  focus: Focus | null
  onSelectStation: (code: string) => void
  onSelectCamera: (key: string) => void
  onStyleFailure: () => void
}

const MTR_LAYERS = ['mtr-lines', 'stations', 'station-labels']
const CAMERA_LAYERS = ['camera-clusters', 'camera-count', 'camera-points']

export function MapView({
  showMtr,
  showCameras,
  cameras,
  selectedStation,
  panelOpen,
  focus,
  onSelectStation,
  onSelectCamera,
  onStyleFailure,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
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

    map.on('load', () => {
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
          'line-opacity': 0.92,
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

      map.on('click', (event) => {
        const { showMtr: mtrOn, showCameras: camerasOn, onSelectStation: pickStation, onSelectCamera: pickCamera } =
          handlersRef.current
        const layers = [
          ...(mtrOn ? ['stations'] : []),
          ...(camerasOn ? ['camera-clusters', 'camera-points'] : []),
        ].filter((layer) => map.getLayer(layer))
        if (layers.length === 0) return
        const features = map.queryRenderedFeatures(event.point, { layers })
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

      map.on('mouseenter', 'stations', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'stations', () => {
        map.getCanvas().style.cursor = ''
      })
      for (const layer of ['camera-points', 'camera-clusters']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }
    })

    const styleTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) handlersRef.current.onStyleFailure()
    }, 20000)

    return () => {
      window.clearTimeout(styleTimer)
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
    if (map.getSource('cameras')) apply()
    else map.once('load', apply)
  }, [cameras])

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
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [showMtr, showCameras])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedStation) return
    const apply = () => {
      if (!map.getSource('stations')) return
      map.setFeatureState({ source: 'stations', id: selectedStation }, { selected: true })
    }
    if (map.getSource('stations')) apply()
    else map.once('load', apply)
    return () => {
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
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
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
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [focus])

  return <div ref={containerRef} className="h-full w-full" />
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
