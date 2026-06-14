import type { TelemetryData } from '@/scene/Scene.tsx';

interface Props {
  data: TelemetryData;
}

const style: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 12,
    right: 12,
    background: 'rgba(10, 10, 30, 0.85)',
    border: '1px solid rgba(90, 120, 200, 0.4)',
    borderRadius: 8,
    padding: '10px 14px',
    minWidth: 200,
    color: '#c8d8ff',
    fontSize: 12,
    lineHeight: 1.7,
    backdropFilter: 'blur(6px)',
    userSelect: 'none',
  },
  title: {
    fontSize: 10,
    letterSpacing: 2,
    color: '#5a78c8',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    color: '#7a98e8',
  },
  value: {
    color: '#e8f0ff',
    fontVariantNumeric: 'tabular-nums',
  },
};

function indicatorStyle(driving: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: driving ? '#69f0ae' : '#444',
    marginRight: 6,
    verticalAlign: 'middle',
    boxShadow: driving ? '0 0 6px #69f0ae' : 'none',
  };
}

function fmt(n: number, decimals = 2): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : '∞';
}

export function Telemetry({ data }: Props): React.ReactElement {
  const { x, y, headingDeg, steeringDeg, turningRadius, speed, driving } = data;

  // Normalize heading to [0, 360).
  const hdg = ((headingDeg % 360) + 360) % 360;

  return (
    <div style={style.panel}>
      <div style={style.title}>Telemetry</div>
      <div style={style.row}>
        <span style={style.label}>Status</span>
        <span style={style.value}>
          <span style={indicatorStyle(driving)} />
          {driving ? 'Moving' : 'Stopped'}
        </span>
      </div>
      <div style={style.row}>
        <span style={style.label}>Position</span>
        <span style={style.value}>
          ({fmt(x, 1)}, {fmt(y, 1)}) m
        </span>
      </div>
      <div style={style.row}>
        <span style={style.label}>Heading</span>
        <span style={style.value}>{fmt(hdg, 1)}°</span>
      </div>
      <div style={style.row}>
        <span style={style.label}>Steering</span>
        <span style={style.value}>{fmt(steeringDeg, 1)}°</span>
      </div>
      <div style={style.row}>
        <span style={style.label}>Turn radius</span>
        <span style={style.value}>
          {Number.isFinite(turningRadius)
            ? `${fmt(Math.abs(turningRadius), 2)} m`
            : '∞ (straight)'}
        </span>
      </div>
      <div style={style.row}>
        <span style={style.label}>Speed</span>
        <span style={style.value}>{fmt(speed, 1)} m/s</span>
      </div>
    </div>
  );
}
