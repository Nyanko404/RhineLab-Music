export type GpuMode = "auto" | "high" | "low";
export type RenderBackend = "vulkan" | "auto" | "d3d11" | "gl";

export interface DesktopHostStatus {
  desktop: boolean;
  frameless?: boolean;
  gpuMode: GpuMode;
  renderBackend: RenderBackend;
}

export async function probeDesktopHost(): Promise<DesktopHostStatus | null> {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return null;
  try {
    const res = await fetch("/__rhine/desktop", {
      cache: "no-store",
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      desktop?: boolean;
      frameless?: boolean;
      gpuMode?: GpuMode;
      renderBackend?: RenderBackend;
    };
    if (!data?.desktop) return null;
    return {
      desktop: true,
      frameless: Boolean(data.frameless),
      gpuMode:
        data.gpuMode === "high" || data.gpuMode === "low"
          ? data.gpuMode
          : "auto",
      renderBackend:
        data.renderBackend === "vulkan" ||
        data.renderBackend === "d3d11" ||
        data.renderBackend === "gl"
          ? data.renderBackend
          : "auto",
    };
  } catch {
    return null;
  }
}

export async function setDesktopGpuMode(mode: GpuMode) {
  const res = await fetch("/__rhine/gpu-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error("無法儲存 GPU 模式設定");
  return res.json() as Promise<{
    ok: boolean;
    gpuMode: GpuMode;
    restartRequired: boolean;
  }>;
}

export async function setDesktopRenderBackend(backend: RenderBackend) {
  const res = await fetch("/__rhine/render-backend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend }),
  });
  if (!res.ok) throw new Error("無法儲存渲染後端設定");
  return res.json() as Promise<{
    ok: boolean;
    renderBackend: RenderBackend;
    restartRequired: boolean;
  }>;
}

export async function restartDesktopApp() {
  const res = await fetch("/__rhine/restart", { method: "POST" });
  if (!res.ok) throw new Error("無法重啟桌面應用程式");
}

export interface DesktopDiagnostics {
  ok: boolean;
  gpuMode: GpuMode;
  renderBackend: RenderBackend;
  logPath: string;
  logs: string[];
}

export async function getDesktopDiagnostics(): Promise<DesktopDiagnostics | null> {
  try {
    const res = await fetch("/__rhine/diagnostics", {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as DesktopDiagnostics;
  } catch {
    return null;
  }
}
