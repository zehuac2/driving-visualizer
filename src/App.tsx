import { useRef, useEffect, useState, useCallback } from 'react';
import { SceneManager } from './scene/SceneManager.ts';
import type { TelemetryData } from './scene/SceneManager.ts';
import { DEFAULT_PARAMS } from './sim/CarModel.ts';
import type { CarParams } from './sim/CarModel.ts';
import { Telemetry } from './ui/Telemetry.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { ParameterPanel } from './ui/ParameterPanel.tsx';
import { Controls } from './ui/Controls.tsx';

const INITIAL_TELEMETRY: TelemetryData = {
  x: 0,
  y: 0,
  headingDeg: 90,
  steeringDeg: 0,
  turningRadius: Infinity,
  speed: DEFAULT_PARAMS.speed,
  driving: false,
};

export function App(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);

  const [params, setParams] = useState<CarParams>(DEFAULT_PARAMS);
  const [telemetry, setTelemetry] = useState<TelemetryData>(INITIAL_TELEMETRY);
  const [fillVisible, setFillVisible] = useState(true);

  // Initialize SceneManager once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sm = new SceneManager(canvas, params, (data) => {
      setTelemetry(data);
    });
    sceneRef.current = sm;

    return () => {
      sm.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propagate param changes to SceneManager without re-creating it.
  const handleParamChange = useCallback((p: CarParams) => {
    setParams(p);
    sceneRef.current?.updateParams(p);
  }, []);

  const handleReset = useCallback(() => {
    sceneRef.current?.resetCarPose();
  }, []);

  const handleClearTraces = useCallback(() => {
    sceneRef.current?.clearTraces();
  }, []);

  const handleCenterSteering = useCallback(() => {
    sceneRef.current?.centerSteering();
  }, []);

  const handleToggleFill = useCallback(() => {
    const next = sceneRef.current?.toggleFill();
    if (next !== undefined) setFillVisible(next);
  }, []);

  const handleCenterCamera = useCallback(() => {
    sceneRef.current?.centerCameraOnCar();
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      <Telemetry data={telemetry} />
      <Toolbar
        fillVisible={fillVisible}
        onReset={handleReset}
        onClearTraces={handleClearTraces}
        onCenterSteering={handleCenterSteering}
        onToggleFill={handleToggleFill}
        onCenterCamera={handleCenterCamera}
      />
      <ParameterPanel params={params} onChange={handleParamChange} />
      <Controls />
    </div>
  );
}
