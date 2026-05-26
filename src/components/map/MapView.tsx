import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { calcCandidates } from '../../hooks/useRouteCalc'
import { POINT_ICONS, ROUTE_STYLES } from './mapStyles'

const GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'

export default function MapView({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<L.Layer[]>([])
  const casualtyMarkerRef = useRef<L.Marker | null>(null)
  const candidateLayersRef = useRef<L.Layer[]>([])

  const { routes, points } = useRaceStore()
  const { mode, activeTool } = useModeStore()
  const { position, selectedCandidateId, setPosition, candidates } = useCasualtyStore()

  // 地図初期化
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView([35.7, 137.5], 10)
    L.tileLayer(GSI_URL, { attribution: '©国土地理院', maxZoom: 18 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // 地図クリック
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: L.LeafletMouseEvent) => {
      if (mode === 'operation') {
        const { lat, lng } = e.latlng
        const newCandidates = calcCandidates({ lat, lng }, routes, points)
        setPosition({ lat, lng }, newCandidates)
      } else if (activeTool === 'add_point') {
        onMapClick?.(e.latlng.lat, e.latlng.lng)
      }
    }
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [mode, activeTool, routes, points, onMapClick, setPosition])

  // ルート・ポイント描画
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []

    for (const route of routes) {
      if (route.coords.length < 2) continue
      const latlngs = route.coords.map(c => [c.lat, c.lng] as [number, number])
      const style = ROUTE_STYLES[route.type]
      const line = L.polyline(latlngs, style).addTo(map)
      line.bindTooltip(route.name, { sticky: true })
      layersRef.current.push(line)

      if (route.junction) {
        const m = L.circleMarker([route.junction.lat, route.junction.lng], {
          radius: 6, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 1, weight: 2,
        }).addTo(map)
        m.bindTooltip(`分岐: ${route.name}`)
        layersRef.current.push(m)
      }
    }

    for (const pt of points) {
      const icon = L.divIcon({
        html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));${!pt.enabled ? 'opacity:0.35' : ''}">${POINT_ICONS[pt.type]}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: '',
      })
      const marker = L.marker([pt.lat, pt.lng], { icon }).addTo(map)
      marker.bindPopup(`<b>${pt.name}</b><br><span style="font-size:11px">${pt.note || ''}</span>`)
      layersRef.current.push(marker)
    }
  }, [routes, points])

  // 傷病者マーカー
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    casualtyMarkerRef.current?.remove()
    if (!position) { casualtyMarkerRef.current = null; return }
    const icon = L.divIcon({
      html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🚨</div>',
      iconSize: [32, 32], iconAnchor: [16, 16], className: '',
    })
    const m = L.marker([position.lat, position.lng], { icon, zIndexOffset: 1000 }).addTo(map)
    m.bindPopup('傷病者位置').openPopup()
    casualtyMarkerRef.current = m
  }, [position])

  // 選択候補ハイライト
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    candidateLayersRef.current.forEach(l => l.remove())
    candidateLayersRef.current = []
    if (!selectedCandidateId || !position) return

    const cand = candidates.find(c => c.id === selectedCandidateId)
    if (!cand) return

    for (const seg of cand.segments) {
      const route = routes.find(r => r.id === seg.routeId)
      if (!route) continue
      const from = Math.min(seg.fromIndex, seg.toIndex)
      const to = Math.max(seg.fromIndex, seg.toIndex)
      const slice = route.coords.slice(from, to + 2)
      const coords = seg.direction === 'backward' ? [...slice].reverse() : slice
      const line = L.polyline(coords.map(c => [c.lat, c.lng] as [number, number]), {
        color: '#f97316', weight: 6, opacity: 0.85,
      }).addTo(map)
      candidateLayersRef.current.push(line)
    }
  }, [selectedCandidateId, candidates, routes, position])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
}
