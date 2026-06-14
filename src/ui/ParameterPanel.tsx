import { useState } from "react";
import type { CarParams } from "../sim/CarModel.ts";

interface Props {
  params: CarParams;
  onChange: (p: CarParams) => void;
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(10, 10, 30, 0.88)",
  border: "1px solid rgba(90, 120, 200, 0.4)",
  borderRadius: 10,
  padding: "12px 18px",
  backdropFilter: "blur(8px)",
  userSelect: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 560,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 11,
  color: "#c8d8ff",
};

const labelStyle: React.CSSProperties = {
  width: 150,
  color: "#7a98e8",
  textAlign: "right",
  flexShrink: 0,
};

const valueStyle: React.CSSProperties = {
  width: 52,
  textAlign: "right",
  color: "#e8f0ff",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};

const unitStyle: React.CSSProperties = {
  width: 30,
  color: "#5a78c8",
  flexShrink: 0,
};

const sliderStyle: React.CSSProperties = {
  flexGrow: 1,
  accentColor: "#3a86ff",
  cursor: "pointer",
};

const titleStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 2,
  color: "#5a78c8",
  marginBottom: 4,
  textTransform: "uppercase",
  textAlign: "center",
};

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  decimals?: number;
  onChange: (v: number) => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = 2,
  onChange,
}: SliderRowProps): React.ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        type="range"
        style={sliderStyle}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span style={valueStyle}>{value.toFixed(decimals)}</span>
      <span style={unitStyle}>{unit}</span>
    </div>
  );
}

export function ParameterPanel({ params, onChange }: Props): React.ReactElement {
  const [open, setOpen] = useState(true);

  function set<K extends keyof CarParams>(key: K, val: CarParams[K]): void {
    onChange({ ...params, [key]: val });
  }

  const steerDeg = (params.maxSteeringAngle * 180) / Math.PI;
  const steerRateDeg = (params.steeringRate * 180) / Math.PI;

  return (
    <div style={panelStyle}>
      <div
        style={{ ...titleStyle, cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Car Parameters
      </div>
      {open && (
        <>
          <SliderRow
            label="Wheelbase"
            value={params.wheelbase}
            min={1.5}
            max={6.0}
            step={0.05}
            unit="m"
            onChange={(v) => set("wheelbase", v)}
          />
          <SliderRow
            label="Front Overhang"
            value={params.frontOverhang}
            min={0.1}
            max={2.0}
            step={0.05}
            unit="m"
            onChange={(v) => set("frontOverhang", v)}
          />
          <SliderRow
            label="Rear Overhang"
            value={params.rearOverhang}
            min={0.1}
            max={2.0}
            step={0.05}
            unit="m"
            onChange={(v) => set("rearOverhang", v)}
          />
          <SliderRow
            label="Body Width"
            value={params.bodyWidth}
            min={1.0}
            max={3.0}
            step={0.05}
            unit="m"
            onChange={(v) => set("bodyWidth", v)}
          />
          <SliderRow
            label="Max Steering Angle"
            value={steerDeg}
            min={5}
            max={55}
            step={1}
            unit="°"
            decimals={0}
            onChange={(v) => set("maxSteeringAngle", (v * Math.PI) / 180)}
          />
          <SliderRow
            label="Steering Rate"
            value={steerRateDeg}
            min={10}
            max={180}
            step={5}
            unit="°/s"
            decimals={0}
            onChange={(v) => set("steeringRate", (v * Math.PI) / 180)}
          />
          <SliderRow
            label="Speed"
            value={params.speed}
            min={0.5}
            max={20}
            step={0.5}
            unit="m/s"
            onChange={(v) => set("speed", v)}
          />
        </>
      )}
    </div>
  );
}
