import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap }
  from "react-leaflet";
import L, { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CorridorDetail } from "../../api/client";

// Custom pin (SVG in a divIcon so we don't depend on external assets)
function stationIcon(seq: number, isTerminus: boolean): L.DivIcon {
  const bg = isTerminus ? "#b7402e" : "#3d5a80";
  return L.divIcon({
    className: "station-marker",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${bg};color:#fff;display:grid;place-items:center;
      font-size:11px;font-weight:700;
      box-shadow:0 0 0 3px rgba(255,255,255,0.8),0 2px 4px rgba(0,0,0,0.25);
    ">${seq}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

function FitBounds({ points }: { points: LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const b = L.latLngBounds(points as any);
    map.fitBounds(b, { padding: [30, 30] });
  }, [points, map]);
  return null;
}

export function CorridorMap({ corridor }: { corridor: CorridorDetail | null }) {
  const points: LatLngExpression[] = useMemo(
    () => (corridor?.stations ?? []).map((s) => [s.lat, s.lon]),
    [corridor]
  );

  return (
    <div style={{ height: 460, width: "100%", borderRadius: 8,
                  overflow: "hidden", border: "1px solid var(--border)" }}>
      <MapContainer
        center={[53.35, -2.55] as LatLngExpression}
        zoom={10}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {corridor && (
          <>
            <Polyline positions={points} color="#3d5a80" weight={4}
                       opacity={0.75} />
            {corridor.stations.map((s, i) => (
              <Marker key={s.seq} position={[s.lat, s.lon]}
                      icon={stationIcon(s.seq,
                                        i === 0
                                        || i === corridor.stations.length - 1)}>
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {s.name}
                    </div>
                    <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
                      <tbody>
                        <tr><td style={{ color: "#64748b" }}>TIPLOC</td>
                            <td style={{ paddingLeft: 8 }}>{s.tiploc || "-"}</td></tr>
                        <tr><td style={{ color: "#64748b" }}>CRS</td>
                            <td style={{ paddingLeft: 8 }}>{s.crs || "-"}</td></tr>
                        <tr><td style={{ color: "#64748b" }}>STANOX</td>
                            <td style={{ paddingLeft: 8 }}>{s.stanox || "-"}</td></tr>
                        <tr><td style={{ color: "#64748b" }}>STANME</td>
                            <td style={{ paddingLeft: 8 }}>{s.stanme || "-"}</td></tr>
                        <tr><td style={{ color: "#64748b" }}>km</td>
                            <td style={{ paddingLeft: 8 }}>{s.chainage_km.toFixed(3)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </Popup>
              </Marker>
            ))}
            <FitBounds points={points} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
