// Compact controls reference shown in the bottom-right corner.

const style: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  background: 'rgba(10, 10, 30, 0.75)',
  border: '1px solid rgba(90, 120, 200, 0.3)',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#6a88c8',
  fontSize: 10,
  lineHeight: 1.8,
  backdropFilter: 'blur(6px)',
  userSelect: 'none',
  letterSpacing: 0.3,
};

const key: React.CSSProperties = {
  display: 'inline-block',
  background: 'rgba(90, 120, 200, 0.2)',
  border: '1px solid rgba(90, 120, 200, 0.45)',
  borderRadius: 3,
  padding: '0 4px',
  color: '#90aaee',
  fontFamily: 'inherit',
  fontSize: 10,
  lineHeight: 1.5,
  marginRight: 2,
};

function K({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={key}>{children}</span>;
}

export function Controls(): React.ReactElement {
  return (
    <div style={style}>
      <K>W</K>
      <K>↑</K> Forward &nbsp; <K>S</K>
      <K>↓</K> Reverse
      <br />
      <K>A</K>
      <K>←</K> Steer Left &nbsp; <K>D</K>
      <K>→</K> Right
      <br />
      (releases auto-center) &nbsp; <K>Space</K> Hold
      <br />
      <K>C</K> Center Steering
      <br />
      <K>Scroll</K> Zoom &nbsp; <K>Drag</K> Pan
    </div>
  );
}
