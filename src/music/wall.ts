import { ArchiveScene } from "../scene";
import { ModelViewer } from "../model-viewer";
import { fullMotion, reducedMotion } from "../motion-preferences";
import { SceneCovers, type SceneCover } from "./scene-covers";
import { columnFiles } from "../data";
import {
  wrap,
  type ArchiveCell,
  type ArchiveNavigation,
} from "../archive-loop";
import {
  normalizeQuality,
  qualityPresets,
  type AntialiasMode,
  type RenderQuality,
  type RenderResolution,
} from "../render-quality";
import { superPerformanceQuality } from "../wallpaper-quality";
import { quietBands } from "../archive-play-motion";
import type { Track } from "./types";
import { sourceNames } from "./types";
import type { Preferences } from "./library";

const slots = Array.from({ length: 5 }, (_, column) =>
  columnFiles(column),
).flat();
export function detectWebglRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl || !("getParameter" in gl)) return "WebGL 不可用";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "")
      : String(gl.getParameter(gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name.trim() || "未知 GPU";
  } catch {
    return "無法偵測 GPU";
  }
}

export class MusicWall {
  private scene?: ArchiveScene;
  private host: HTMLElement;
  private status: HTMLElement;
  private notifySelection: (track: Track, userInitiated?: boolean) => void;
  private viewer?: ModelViewer;
  private artwork: (track: Track) => Promise<string | undefined>;
  private artworkVersion: (key: string) => number;
  private decodedCovers = new Map<string, HTMLImageElement>();
  private onGpuDetected?: (name: string) => void;
  private onWebglError?: () => void;
  private onInteractionStart?: () => void;
  gpuName = "";
  private list: Track[] = [];
  private index = 0;
  private software = false;
  private frame = 0;
  private revision = 0;
  private labelRevision = 0;
  private selectedLabelRevision = 0;
  private coverKeys = "";
  private inspection = true;
  private ready = false;
  private observer?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private visible = true;
  private configured?: string;
  private wanted?: string;
  private wantedQuality: Preferences["quality"] = "original";
  private wantedCustomQuality?: RenderQuality;
  private wantedResolution: RenderResolution = "native";
  private wantedAntialias: AntialiasMode = "smaa";
  private wantedDark = false;
  private wantedReduced = false;
  private selected?: Track;
  private appliedKey?: string;
  private appliedIndex = -1;
  private currentSlot = 0;

  constructor(
    host: HTMLElement,
    status: HTMLElement,
    select: (track: Track, userInitiated?: boolean) => void,
    artwork: (track: Track) => Promise<string | undefined>,
    artworkVersion: (key: string) => number = () => 0,
    onGpuDetected?: (name: string) => void,
    onWebglError?: () => void,
    onInteractionStart?: () => void,
  ) {
    this.host = host;
    this.status = status;
    this.notifySelection = select;
    this.artwork = artwork;
    this.artworkVersion = artworkVersion;
    this.onGpuDetected = onGpuDetected;
    this.onWebglError = onWebglError;
    this.onInteractionStart = onInteractionStart;
  }
  setTracks(tracks: Track[], current?: Track) {
    const previousIndex = this.index;
    this.list = tracks;
    const index = current
      ? tracks.findIndex((track) => track.key === current.key)
      : -1;
    if (index >= 0) this.index = index;
    else if (this.index >= tracks.length) this.index = 0;
    const track = tracks[this.index];
    if (
      track !== this.selected ||
      this.index !== previousIndex ||
      track?.key !== this.appliedKey ||
      this.index !== this.appliedIndex
    )
      this.select(
        this.index,
        undefined,
        false,
        undefined,
        Boolean(this.appliedKey && track && track.key !== this.appliedKey),
      );
    else this.loadCovers();
  }
  private resolveRenderQuality(
    preset: Preferences["quality"],
    custom?: RenderQuality,
  ): RenderQuality {
    if (this.software || preset === "performance") {
      return {
        ...superPerformanceQuality,
        transmission: this.software ? 0.5 : 0.25,
      };
    }
    const base =
      preset === "balanced"
        ? qualityPresets.balanced
        : preset === "high"
          ? qualityPresets.high
          : preset === "ultra"
            ? qualityPresets.ultra
            : preset === "custom"
              ? normalizeQuality(custom)
              : qualityPresets.original;
    return { ...base, antialias: this.wantedAntialias };
  }

  async configure(
    quality: Preferences["quality"],
    dark: boolean,
    reduced: boolean,
    customQuality?: RenderQuality,
  ) {
    const normalizedCustom =
      quality === "custom" ? normalizeQuality(customQuality) : undefined;
    const signature = [
      quality,
      dark,
      reduced,
      normalizedCustom ? JSON.stringify(normalizedCustom) : "",
    ].join(":");
    this.wantedQuality = quality;
    this.wantedDark = dark;
    this.wantedReduced = reduced;
    this.wantedCustomQuality = normalizedCustom;
    if (signature === this.wanted && (this.scene || quality === "off")) return;
    this.wanted = signature;
    if (!this.scene && this.configured === signature) return;
    if (quality === "off") {
      this.revision++;
      this.close();
      this.configured = signature;
      this.host.dataset.state = "off";
      this.status.textContent = "2D 模式";
      return;
    }
    const update = (
      scene: ArchiveScene,
      preset = quality,
      night = dark,
      calm = reduced,
      custom = normalizedCustom,
    ) => {
      scene.setTheme(night, !this.ready);
      scene.setReduced(calm);
      const performance = preset === "performance" || this.software;
      const resolvedQuality = this.resolveRenderQuality(preset, custom);
      scene.setQuality(resolvedQuality);
      scene.setResolution(this.wantedResolution);
      scene.musicCovers?.setAnisotropy(resolvedQuality.anisotropy);
      scene.setSuperPerformance(performance);
    };
    if (this.scene && this.ready) {
      update(this.scene);
      return;
    }
    if (this.scene) return;
    const revision = ++this.revision;
    this.configured = signature;
    this.host.dataset.state = "loading";
    this.status.textContent = "載入三維陣列…";
    try {
      const scene = new ArchiveScene(this.host);
      this.scene = scene;
      scene.setTheme(dark, true);
      const gl = scene.renderer.getContext();
      const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const rawGpu = rendererInfo
        ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) ?? "")
        : String(gl.getParameter(gl.RENDERER) ?? "");
      this.gpuName = rawGpu.trim() || "未知 GPU";
      this.onGpuDetected?.(this.gpuName);
      this.software = Boolean(
        rendererInfo &&
        /swiftshader|llvmpipe|software|warp/i.test(this.gpuName),
      );
      const low = new URL(
        "../../reference/model-precision/low.glb",
        import.meta.url,
      );
      await scene.load(this.software ? low.href : undefined);
      if (revision !== this.revision) {
        scene.dispose();
        return;
      }
      this.ready = true;
      update(
        scene,
        this.wantedQuality === "off" ? "original" : this.wantedQuality,
        this.wantedDark,
        this.wantedReduced,
        this.wantedCustomQuality,
      );
      scene.allowDetailBrowse = false;
      scene.detailBackgroundMotion = true;
      scene.musicCovers = new SceneCovers(scene.scene);
      scene.setMode(this.inspection ? "detail" : "archive");
      scene.revealImmediately();
      scene.renderer.domElement.setAttribute(
        "aria-label",
        "3D 唱片展示，可左右拖曳檢視、滾輪縮放",
      );
      scene.onSelect = (record, cell) => this.pick(slots.indexOf(record), cell);
      scene.onInteractionStart = () => this.onInteractionStart?.();
      scene.onNavigate = (axis, direction) => {
        this.onInteractionStart?.();
        this.step(direction * (axis === "lane" ? 8 : 1));
      };
      scene.renderer.domElement.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        if (this.scene !== scene || this.wantedQuality === "off") return;
        this.host.dataset.state = "error";
        this.status.textContent = "GPU 繪圖環境中斷，正在嘗試恢復…";
      });
      scene.renderer.domElement.addEventListener("webglcontextrestored", () => {
        if (this.scene !== scene || this.wantedQuality === "off") return;
        this.host.dataset.state = "ready";
        this.status.textContent = this.selected?.title ?? "拖曳或捲動瀏覽";
        scene.resize();
      });
      scene.onHover = (index) => {
        const track =
          index === null
            ? undefined
            : this.trackAtSlot(slots.indexOf(index));
        this.status.textContent =
          track?.title ?? this.selected?.title ?? "拖曳或捲動瀏覽";
      };
      this.select(this.index);
      scene.setMode(this.inspection ? "detail" : "archive", true);
      scene.setKeepClear(true);
      scene.finishDecryption();
      this.host.dataset.state = "ready";
      this.observer = new ResizeObserver(() => {
        if (this.host.clientWidth && this.host.clientHeight) scene.resize();
        this.viewer?.resize();
      });
      this.observer.observe(this.host);
      this.visibility = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
      });
      this.visibility.observe(this.host);
      let lastDraw = -Infinity;
      const draw = (time: number) => {
        this.frame = requestAnimationFrame(draw);
        if (
          !document.hidden &&
          this.visible &&
          this.host.clientWidth &&
          (!this.software || time - lastDraw >= 60)
        ) {
          lastDraw = time;
          try {
            if (this.viewer?.isOpen) this.viewer.update(time / 1000);
            else scene.update(time / 1000);
            if (!this.host.dataset.drawn) this.host.dataset.drawn = "true";
          } catch (err) {
            console.error("[MusicWall] frame error:", err);
          }
        }
      };
      this.frame = requestAnimationFrame(draw);
    } catch (error) {
      console.error("[MusicWall] init failed:", error);
      if (revision !== this.revision) return;
      this.close();
      this.host.dataset.state = "error";
      this.status.textContent = "WebGL 無法使用，歌曲列表仍可操作";
      this.onWebglError?.();
    }
  }
  private select(
    index: number,
    navigation?: ArchiveNavigation,
    userInitiated = false,
    explicitSlot?: number,
    forceSwitch = false,
  ) {
    this.index = index;
    this.selected = this.list[index];
    if (this.selected) this.notifySelection(this.selected, userInitiated);
    if (!this.ready || !this.scene) return;
    const slotIdx =
      explicitSlot !== undefined && explicitSlot >= 0
        ? explicitSlot % slots.length
        : index % slots.length;
    this.currentSlot = slotIdx;
    this.appliedKey = this.selected?.key;
    this.appliedIndex = index;
    this.scene.select(slots[slotIdx] ?? slots[0], navigation, forceSwitch);
    const track = this.selected;
    this.status.textContent = track?.title ?? "拖曳或捲動瀏覽";
    const scene = this.scene;
    const label = {
      number: index + 1,
      source: track ? sourceNames[track.source] : "SIGNAL ARRAY",
    };
    const revision = ++this.selectedLabelRevision;
    scene.setMusicLabel(label);
    if (track)
      void this.coverImage(track)
        .then((artwork) => {
          if (
            artwork &&
            revision === this.selectedLabelRevision &&
            scene === this.scene
          )
            scene.setMusicLabel({ ...label, artwork });
        })
        .catch(() => {});
    this.loadCovers();
  }
  private trackAtSlot(slotIdx: number): Track | undefined {
    if (!this.list.length || slotIdx < 0) return undefined;
    const direct = this.offset + slotIdx;
    if (direct < this.list.length) return this.list[direct];
    return this.list[wrap(direct, this.list.length)];
  }
  private async coverImage(track: Track) {
    const cacheKey = `${track.key}@${this.artworkVersion(track.key)}`;
    const cached = this.decodedCovers.get(cacheKey);
    if (cached) {
      this.decodedCovers.delete(cacheKey);
      this.decodedCovers.set(cacheKey, cached);
      return cached;
    }
    const url = await this.artwork(track);
    if (!url) return;
    const image = new Image();
    if (!url.startsWith("blob:")) image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    if (this.decodedCovers.size >= 80) {
      const oldest = this.decodedCovers.keys().next().value;
      if (oldest !== undefined) this.decodedCovers.delete(oldest);
    }
    this.decodedCovers.set(cacheKey, image);
    return image;
  }
  refreshArtwork() {
    this.coverKeys = "";
    this.decodedCovers.clear();
    this.select(this.index);
  }
  private loadCovers() {
    const scene = this.scene;
    const layer = scene?.musicCovers;
    if (!scene || !layer || !this.list.length) return;
    const tracks = Array.from(
      { length: slots.length },
      (_, slotIdx) => this.trackAtSlot(slotIdx)!,
    );
    const keys = JSON.stringify(
      tracks.map((track) => [
        track.key,
        track.title,
        track.artwork,
        this.artworkVersion(track.key),
      ]),
    );
    if (keys === this.coverKeys) return;
    this.coverKeys = keys;
    const revision = ++this.labelRevision;
    const covers: SceneCover[] = tracks.map((track, index) => {
      const cacheKey = `${track.key}@${this.artworkVersion(track.key)}`;
      return {
        index: slots[index],
        title: track.title,
        source: sourceNames[track.source],
        artwork: this.decodedCovers.get(cacheKey),
      };
    });
    layer.set(covers);
    const pending = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ index }) => !covers[index].artwork);
    if (!pending.length) return;
    const selectedLocal = this.currentSlot;
    pending.sort(
      (a, b) =>
        Math.abs(a.index - selectedLocal) - Math.abs(b.index - selectedLocal),
    );
    const batchSize = 6;
    const runBatch = async (start: number) => {
      if (revision !== this.labelRevision) return;
      const chunk = pending.slice(start, start + batchSize);
      let updated = false;
      await Promise.allSettled(
        chunk.map(async ({ track, index }) => {
          const img = await this.coverImage(track);
          if (img) {
            covers[index].artwork = img;
            updated = true;
          }
        }),
      );
      if (revision !== this.labelRevision) return;
      if (updated) layer.set(covers);
      if (start + batchSize < pending.length) {
        setTimeout(() => void runBatch(start + batchSize), 16);
      }
    };
    void runBatch(0);
  }
  private pick(index: number, cell?: ArchiveCell) {
    if (index < 0 || !this.list.length) return;
    let candidate = this.offset + index;
    if (this.list.length > slots.length) {
      const delta = index - this.currentSlot;
      if (
        delta < -slots.length / 2 &&
        this.offset + slots.length + index < this.list.length
      ) {
        candidate = this.offset + slots.length + index;
      } else if (delta > slots.length / 2 && this.offset - slots.length + index >= 0) {
        candidate = this.offset - slots.length + index;
      }
    }
    const actual =
      candidate >= 0 && candidate < this.list.length
        ? candidate
        : wrap(candidate, this.list.length);
    if (this.list[actual])
      this.select(actual, cell ? { cell } : undefined, true, index);
  }
  private get offset() {
    return Math.floor(this.index / slots.length) * slots.length;
  }
  get viewerOpen() {
    return this.viewer?.isOpen ?? false;
  }
  openViewer(
    root: HTMLElement,
    track: Track,
    number: string,
    dark: boolean,
    reduced: boolean,
  ) {
    const scene = this.scene;
    if (!scene || !this.ready) return false;
    try {
      const viewer = (this.viewer ??= new ModelViewer(root, () => {}));
      viewer.setMotion(reduced ? reducedMotion() : fullMotion());
      viewer.setTheme(Number(dark));
      const performance = this.software || this.wantedQuality === "performance";
      viewer.setSuperPerformance(performance);
      viewer.setQuality(
        this.resolveRenderQuality(this.wantedQuality, this.wantedCustomQuality),
      );
      viewer.open(
        number,
        track.title,
        () => scene.createAssemblyModel(),
        reduced,
      );
      viewer.root.querySelector("#viewer-file")!.textContent =
        number + " / MUSIC LIBRARY";
      viewer.root.querySelector(".viewer-back span")!.textContent =
        "返回音樂終端";
      return true;
    } catch {
      return false;
    }
  }
  inspect(value = !this.inspection) {
    if (this.inspection === value) return value;
    this.inspection = value;
    this.scene?.setMode(value ? "detail" : "archive");
    return value;
  }
  step(direction: number) {
    if (!this.list.length) return;
    const nextIndex = wrap(this.index + direction, this.list.length);
    const nextSlot = wrap(this.currentSlot + direction, slots.length);
    const nav: ArchiveNavigation =
      Math.abs(direction) >= 8
        ? { axis: "lane", direction: Math.sign(direction) }
        : { axis: "row", direction: Math.sign(direction) || 1 };
    this.select(
      nextIndex,
      nav,
      true,
      this.list.length < slots.length ? nextSlot : undefined,
      true,
    );
  }
  resetView() {
    this.scene?.resetView();
  }
  setRecordLighting(
    mode: "reactive" | "rgb" | "breathing" | "custom" | "off",
    colorHex: string,
    beat = 0,
  ) {
    this.scene?.setRecordLighting(mode, colorHex, beat);
  }
  pulse(bands = quietBands(), beat = 0) {
    this.scene?.setPlayfield(
      bands.activity > 0.01,
      bands,
      0.9,
      0,
      null,
      true,
    );
    this.scene?.setRecordLighting(
      this.lightingMode,
      this.lightingColor,
      beat,
    );
  }
  private lightingMode: "reactive" | "rgb" | "breathing" | "custom" | "off" = "reactive";
  private lightingColor = "#ed853d";
  configureDisplay(
    resolution: RenderResolution,
    antialias: AntialiasMode,
  ) {
    this.wantedResolution = resolution;
    this.wantedAntialias = antialias;
    if (!this.scene) return;
    this.scene.setResolution(resolution);
    if (this.ready) {
      this.scene.setQuality(
        this.resolveRenderQuality(this.wantedQuality, this.wantedCustomQuality),
      );
    }
  }
  configureLighting(
    mode: "reactive" | "rgb" | "breathing" | "custom" | "off",
    colorHex: string,
  ) {
    this.lightingMode = mode;
    this.lightingColor = colorHex;
    this.scene?.setRecordLighting(mode, colorHex, 0);
  }
  private close() {
    this.labelRevision++;
    this.selectedLabelRevision++;
    this.coverKeys = "";
    this.appliedKey = undefined;
    this.appliedIndex = -1;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.visibility?.disconnect();
    delete this.host.dataset.drawn;
    this.viewer?.dispose();
    this.viewer = undefined;
    this.scene?.dispose();
    this.ready = false;
    this.scene = undefined;
  }
}
