import network from '@/data/network.json'

export type LineCode = (typeof network.lines)[number]['code']

export type Station = (typeof network.stations)[number]

export type LineInfo = (typeof network.lines)[number]

export const lines: LineInfo[] = network.lines

export const stations: Station[] = network.stations

export const segments = network.segments

export const tracks = network.tracks ?? []

const stationByCode = new Map(stations.map((station) => [station.code, station]))

const lineByCode = new Map(lines.map((line) => [line.code, line]))

export function stationName(code: string) {
  return stationByCode.get(code)?.nameZh ?? code
}

export function getStation(code: string) {
  return stationByCode.get(code)
}

export function getLine(code: string) {
  return lineByCode.get(code)
}

export function lineFeatures() {
  const tracks = network.tracks ?? []
  const features =
    tracks.length > 0
      ? tracks.map((track) => ({
          type: 'Feature' as const,
          properties: {
            line: track.line,
            color: lineByCode.get(track.line)?.color ?? '#444',
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: track.coordinates,
          },
        }))
      : network.segments.map((segment) => {
          const from = stationByCode.get(segment.from)
          const to = stationByCode.get(segment.to)
          return {
            type: 'Feature' as const,
            properties: {
              line: segment.line,
              color: lineByCode.get(segment.line)?.color ?? '#444',
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [from?.lon ?? 0, from?.lat ?? 0],
                [to?.lon ?? 0, to?.lat ?? 0],
              ],
            },
          }
        })
  return { type: 'FeatureCollection' as const, features }
}

export function stationFeatures() {
  return {
    type: 'FeatureCollection' as const,
    features: stations.map((station) => ({
      type: 'Feature' as const,
      id: station.code,
      properties: {
        code: station.code,
        nameZh: station.nameZh,
        nameEn: station.nameEn,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [station.lon, station.lat],
      },
    })),
  }
}
