import type { LatLngEle } from '../types/race'

export function parseGpx(text: string): LatLngEle[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const pts = [...doc.querySelectorAll('trkpt')]
  if (pts.length === 0) {
    // wpt fallback
    const wpts = [...doc.querySelectorAll('wpt')]
    return wpts.map(w => ({
      lat: parseFloat(w.getAttribute('lat') ?? '0'),
      lng: parseFloat(w.getAttribute('lon') ?? '0'),
      ele: parseFloat(w.querySelector('ele')?.textContent ?? '0'),
    }))
  }
  return pts.map(p => ({
    lat: parseFloat(p.getAttribute('lat') ?? '0'),
    lng: parseFloat(p.getAttribute('lon') ?? '0'),
    ele: parseFloat(p.querySelector('ele')?.textContent ?? '0'),
  }))
}

export function coordsToGpx(coords: LatLngEle[], name: string): string {
  const trkpts = coords.map(c =>
    `    <trkpt lat="${c.lat}" lon="${c.lng}"><ele>${c.ele}</ele></trkpt>`
  ).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="trailrunning-rescue">
  <trk><name>${name}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`
}
