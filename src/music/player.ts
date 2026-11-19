import type { Adapter, Playback, Repeat, Track } from "./types.ts";

export class PlayerController extends EventTarget {
  state: Playback = { status: "idle", time: 0, duration: 0 };
  queue: Track[] = [];
  repeat: Repeat = "off";
  shuffle = false;
  volume = 0.8;
  muted = false;
  adapter?: Adapter;
  private factory: (track: Track) => Adapter;
  private session?: AbortController;
  private remaining: string[] = [];
  private played: string[] = [];

  constructor(factory: (track: Track) => Adapter) {
    super();
    this.factory = factory;
  }

  private update(event: Partial<Playback>) {
    this.state = { ...this.state, ...event };
    this.dispatchEvent(new Event("change"));
  }

  setQueue(queue: Track[]) {
    this.queue = [
      ...new Map(queue.map((track) => [track.key, track])).values(),
    ];
    this.remaining = [];
    this.played = [];
    this.update({});
  }

  setShuffle(enabled: boolean) {
    this.shuffle = enabled;
    this.remaining = [];
    this.played = this.state.track ? [this.state.track.key] : [];
    this.update({});
  }

  setRepeat(repeat: Repeat) {
    this.repeat = repeat;
    this.update({});
  }

  async select(
    track: Track,
    queue?: Track[],
    options: { autoplay?: boolean; position?: number } = {},
  ) {
    const autoplay = options.autoplay ?? true;
    this.session?.abort();
    this.adapter?.destroy();
    this.adapter = undefined;
    const session = new AbortController();
    this.session = session;
    if (queue) this.setQueue(queue);
    if (!this.queue.some((item) => item.key === track.key))
      this.queue.push(track);
    this.remaining = this.remaining.filter((key) => key !== track.key);
    if (this.shuffle && this.played.at(-1) !== track.key)
      this.played.push(track.key);
    this.update({
      track,
      status: "loading",
      time: 0,
      duration: track.duration ?? 0,
      message: undefined,
    });
    try {
      const adapter = this.factory(track);
      this.adapter = adapter;
      await adapter.load(
        track,
        (event) => {
          if (session.signal.aborted) return;
          const previous = this.state.status;
          this.update(event);
          if (event.status === "ended" && previous !== "ended")
            void this.next(true);
        },
        session.signal,
      );
      if (session.signal.aborted) return;
      adapter.volume?.(this.muted ? 0 : this.volume);
      if (options.position && adapter.seek) this.seek(options.position);
      if (
        autoplay &&
        adapter.play &&
        this.state.status !== "error" &&
        this.state.status !== "external"
      )
        await adapter.play();
    } catch (error) {
      if (!session.signal.aborted) this.fail(error);
    }
  }

  restoreRemote(track: Track, position: number) {
    this.update({
      track,
      time: position,
      duration: track.duration ?? 0,
      status: "idle",
      message: "已恢復曲目。可手動載入平台播放器。",
    });
  }

  async toggle() {
    const { track, status } = this.state;
    if (!track) {
      if (this.queue[0]) await this.select(this.queue[0]);
      return;
    }
    if (status === "error" || !this.adapter) {
      await this.select(track, undefined, { position: this.state.time });
      return;
    }
    if (status === "playing") this.pause();
    else await this.play();
  }

  async play() {
    if (
      !this.state.track ||
      !this.adapter?.play ||
      ["loading", "external"].includes(this.state.status)
    )
      return;
    const adapter = this.adapter;
    try {
      if (this.state.status === "ended") adapter.seek?.(0);
      await adapter.play?.();
    } catch (error) {
      if (this.adapter === adapter) this.fail(error);
    }
  }

  pause() {
    this.adapter?.pause?.();
  }
  seek(seconds: number) {
    if (!Number.isFinite(seconds) || (seconds > 0 && !this.state.duration))
      return;
    const clamped =
      seconds <= 0
        ? 0
        : Math.max(0, Math.min(seconds, this.state.duration));
    this.adapter?.seek?.(clamped);
    this.update({ time: clamped });
  }

  setVolume(value: number, muted = this.muted) {
    this.volume = Math.max(0, Math.min(1, value));
    this.muted = muted;
    this.adapter?.volume?.(muted ? 0 : this.volume);
    this.update({});
  }

  async next(automatic = false) {
    if (!this.queue.length) return;
    const current = this.state.track;
    if (automatic && this.repeat === "one" && current) {
      await this.play();
      return;
    }
    const index = this.queue.findIndex((item) => item.key === current?.key);
    let candidate: Track | undefined;
    if (this.shuffle && this.queue.length > 1) {
      if (!this.remaining.length) {
        this.remaining = this.queue
          .map((item) => item.key)
          .filter((key) => key !== current?.key && !this.played.includes(key));
        if (!this.remaining.length && this.repeat === "all") {
          this.played = current ? [current.key] : [];
          this.remaining = this.queue
            .map((item) => item.key)
            .filter((key) => key !== current?.key);
        }
      }
      const [key] = this.remaining.splice(
        Math.floor(Math.random() * this.remaining.length),
        1,
      );
      candidate = this.queue.find((item) => item.key === key);
    } else
      candidate =
        this.queue[index + 1] ??
        (this.repeat === "all" || (!automatic && this.queue.length > 1)
          ? this.queue[0]
          : undefined);
    if (candidate) await this.select(candidate);
  }

  async previous() {
    if (
      this.state.time > 4 &&
      this.adapter?.seek &&
      this.state.status !== "error"
    ) {
      this.seek(0);
      return;
    }
    const index = this.queue.findIndex(
      (item) => item.key === this.state.track?.key,
    );
    const last =
      this.shuffle && this.played.length > 1
        ? this.played[this.played.length - 2]
        : undefined;
    const candidate = last
      ? this.queue.find((item) => item.key === last)
      : (this.queue[index - 1] ??
        (this.repeat === "all" || this.queue.length > 1
          ? this.queue.at(-1)
          : undefined));
    if (candidate) {
      if (last) this.played.pop();
      await this.select(candidate);
    }
  }

  private fail(error: unknown) {
    if (error instanceof Error && error.name === "NotAllowedError") {
      this.update({
        status: "ready",
        message: "瀏覽器需要手動操作，請再按一次播放",
      });
    } else
      this.update({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
  }

  destroy() {
    this.session?.abort();
    this.adapter?.destroy();
    this.adapter = undefined;
    this.update({
      status: "idle",
      track: undefined,
      time: 0,
      duration: 0,
      message: undefined,
    });
  }
}
