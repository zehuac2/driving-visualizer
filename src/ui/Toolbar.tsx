interface Props {
  fillVisible: boolean;
  onReset: () => void;
  onClearTraces: () => void;
  onCenterSteering: () => void;
  onToggleFill: () => void;
  onCenterCamera: () => void;
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

function btn(active?: boolean): React.CSSProperties {
  return {
    background: active ? "rgba(90, 180, 255, 0.25)" : "rgba(10, 10, 30, 0.85)",
    border: `1px solid ${active ? "rgba(90, 180, 255, 0.7)" : "rgba(90, 120, 200, 0.35)"}`,
    borderRadius: 6,
    color: active ? "#90caff" : "#8899cc",
    fontSize: 11,
    letterSpacing: 0.5,
    padding: "5px 10px",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    whiteSpace: "nowrap",
    userSelect: "none",
    transition: "background 0.15s, border-color 0.15s",
  };
}

export function Toolbar({
  fillVisible,
  onReset,
  onClearTraces,
  onCenterSteering,
  onToggleFill,
  onCenterCamera,
}: Props): React.ReactElement {
  return (
    <div style={containerStyle}>
      <button style={btn()} onClick={onReset} title="Reset car to origin">
        ↺ Reset Pose
      </button>
      <button style={btn()} onClick={onClearTraces} title="Clear corner trails">
        ⌫ Clear Traces
      </button>
      <button style={btn()} onClick={onCenterSteering} title="Recenter steering (also: C key)">
        ⟵ Center Steering
      </button>
      <button
        style={btn(fillVisible)}
        onClick={onToggleFill}
        title="Toggle swept area fill"
      >
        ◈ {fillVisible ? "Hide Fill" : "Show Fill"}
      </button>
      <button style={btn()} onClick={onCenterCamera} title="Jump camera to car">
        ⊙ Follow Car
      </button>
    </div>
  );
}
