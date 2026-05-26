import JSZip from 'jszip'
import { parseGpx } from './gpxParser'
import { coordsToGpx } from './gpxParser'
import type { Race, Route, Point } from '../types/race'

export type ZipData = { race: Race; routes: Route[]; points: Point[] }

export async function importZip(file: File): Promise<ZipData> {
  const zip = await JSZip.loadAsync(file)

  const raceFile = zip.file('race.json')
  if (!raceFile) throw new Error('race.json が見つかりません')
  const json = JSON.parse(await raceFile.async('text'))

  const routes: Route[] = []
  for (const rDef of (json.routes ?? [])) {
    const gpxFile = zip.file(rDef.gpxFile)
    const coords = gpxFile ? parseGpx(await gpxFile.async('text')) : []
    routes.push({ ...rDef, coords })
  }

  return { race: json.race ?? { id: '', name: '', date: '', description: '' }, routes, points: json.points ?? [] }
}

export async function exportZip(race: Race, routes: Route[], points: Point[]): Promise<void> {
  const zip = new JSZip()

  const routeDefs = routes.map(r => ({
    id: r.id, name: r.name, type: r.type, gpxFile: r.gpxFile,
    difficulty: r.difficulty, transportSuitability: r.transportSuitability,
    segments: r.segments, junction: r.junction,
  }))

  zip.file('race.json', JSON.stringify({ version: '1.0', race, routes: routeDefs, points }, null, 2))

  for (const r of routes) {
    if (r.coords.length > 0) {
      zip.file(r.gpxFile, coordsToGpx(r.coords, r.name))
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${race.name || 'race'}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
