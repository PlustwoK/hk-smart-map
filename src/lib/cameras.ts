export type TrafficCamera = {
  key: string
  region: string
  district: string
  description: string
  lat: number
  lon: number
  url: string
}

const CAMERA_LIST =
  'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml'

function textOf(parent: Element, tag: string) {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
}

export async function loadCameras(): Promise<TrafficCamera[]> {
  const response = await fetch(CAMERA_LIST)
  if (!response.ok) throw new Error('camera list unavailable')
  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  if (document.querySelector('parsererror')) throw new Error('camera list unreadable')
  const cameras: TrafficCamera[] = []
  for (const image of document.getElementsByTagName('image')) {
    const lat = Number(textOf(image, 'latitude'))
    const lon = Number(textOf(image, 'longitude'))
    const key = textOf(image, 'key')
    const url = textOf(image, 'url')
    if (!key || !url || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    cameras.push({
      key,
      region: textOf(image, 'region'),
      district: textOf(image, 'district'),
      description: textOf(image, 'description'),
      lat,
      lon,
      url,
    })
  }
  if (cameras.length === 0) throw new Error('camera list empty')
  return cameras
}

export function cameraFeatures(cameras: TrafficCamera[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cameras.map((camera) => ({
      type: 'Feature' as const,
      properties: {
        key: camera.key,
        description: camera.description,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [camera.lon, camera.lat],
      },
    })),
  }
}
