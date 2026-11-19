import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { wrap, type ArchiveCell } from "../archive-loop";
import { archiveColumns, columnFiles } from "../data";
import { InstanceUpdates } from "../instance-updates";

const columnSlots = archiveColumns.map((_, lane) => columnFiles(lane));
function indexFor(cell: ArchiveCell) {
  const rows = columnSlots[wrap(cell.lane, columnSlots.length)];
  return rows[wrap(cell.row - 12, rows.length)];
}

const tile = 256;
const grid = { columns: 8, rows: 5 };
export interface SceneCover {
  index: number;
  title: string;
  source: string;
  artwork?: HTMLImageElement;
}

/** One atlas and one instanced draw for the covers on the original cassettes. */
export class SceneCovers {
  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;
  private mesh?: THREE.InstancedMesh;
  private coverUpdates?: InstanceUpdates;
  private matrixUpdates?: InstanceUpdates;
  private root: THREE.Scene;
  private total = 0;

  constructor(root: THREE.Scene) {
    this.root = root;
    this.canvas.width = grid.columns * tile;
    this.canvas.height = grid.rows * tile;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.1,
      toneMapped: false,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float coverIndex;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        `
        #include <uv_vertex>
        float atlasCol = mod(coverIndex, ${grid.columns}.0);
        float atlasRow = floor(coverIndex / ${grid.columns}.0);
        vec2 coverUV = clamp(uv, 0.015, 0.985);
        vMapUv = (coverUV + vec2(atlasCol, ${grid.rows - 1}.0 - atlasRow)) /
          vec2(${grid.columns}.0, ${grid.rows}.0);
      `,
      );
    };
  }

  setAnisotropy(value: number) {
    if (this.texture.anisotropy === value) return;
    this.texture.anisotropy = value;
    this.texture.needsUpdate = true;
  }

  set(covers: readonly SceneCover[]) {
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sources: Record<string, string> = {
      本機: "#564538",
      YouTube: "#773e42",
    };
    const scale = tile / 112;
    for (const { index, title, source, artwork } of covers) {
      const x = (index % grid.columns) * tile;
      const y = Math.floor(index / grid.columns) * tile;
      if (artwork) {
        const side = Math.min(artwork.naturalWidth, artwork.naturalHeight);
        ctx.drawImage(
          artwork,
          (artwork.naturalWidth - side) / 2,
          (artwork.naturalHeight - side) / 2,
          side,
          side,
          x,
          y,
          tile,
          tile,
        );
      } else {
        ctx.fillStyle = sources[source] ?? "#454445";
        ctx.fillRect(x, y, tile, tile);
        ctx.strokeStyle = "#ffc29c";
        ctx.lineWidth = Math.max(1, scale);
        for (const radius of [7, 13, 20, 27]) {
          ctx.beginPath();
          ctx.arc(x + 55 * scale, y + 46 * scale, radius * scale, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.fillStyle = "#fff3e8";
        ctx.font = `bold ${Math.round(13 * scale)}px MiSans, sans-serif`;
        ctx.fillText(title, x + 7 * scale, y + 96 * scale, tile - 14 * scale);
      }
    }
    this.texture.needsUpdate = true;
  }

  update(cells: readonly ArchiveCell[], matrices: Float32Array) {
    const required = cells.length;
    if (required > this.total) {
      this.clearMesh();
      // Front artwork and a visible printed spine share each cassette's transform.
      const front = new THREE.PlaneGeometry(2.15, 2.15).translate(
        0.55,
        2.12,
        0.263,
      );
      const spine = new THREE.PlaneGeometry(2.15, 0.21)
        .rotateX(-Math.PI / 2)
        .translate(0.55, 3.711, 0);
      const geometry = mergeGeometries([front, spine]);
      front.dispose();
      spine.dispose();
      this.total = Math.max(256, required * 2);
      const index = new THREE.InstancedBufferAttribute(
        new Float32Array(this.total),
        1,
      );
      index.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("coverIndex", index);
      this.mesh = new THREE.InstancedMesh(geometry, this.material, this.total);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.coverUpdates = new InstanceUpdates(index);
      this.matrixUpdates = new InstanceUpdates(this.mesh.instanceMatrix);
      this.root.add(this.mesh);
    }
    const mesh = this.mesh;
    if (!mesh) return;
    for (let i = 0; i < cells.length; i++) {
      this.coverUpdates!.scalar(i, indexFor(cells[i]));
      this.matrixUpdates!.set(i * 16, matrices.subarray(i * 16, i * 16 + 16));
    }
    mesh.count = required;
    this.matrixUpdates!.commit();
    this.coverUpdates!.commit();
  }

  dispose() {
    this.clearMesh();
    this.texture.dispose();
    this.material.dispose();
  }
  private clearMesh() {
    if (!this.mesh) return;
    this.root.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
