export interface LyricWord {
  time: number;
  text: string;
}
export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}
const at = (min: string, sec: string) =>
  Number(min) * 60 + Number(sec.replace(":", "."));
export function parseLyrics(source: string): LyricLine[] {
  const offset =
    Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  return source
    .split(/\r?\n/)
    .flatMap((line) => {
      const stamps = [...line.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) return [];
      const rest = line
        .slice((stamps.at(-1)?.index ?? 0) + stamps.at(-1)![0].length)
        .trim();
      const words = [
        ...rest.matchAll(/<(\d+):(\d{1,2}(?:[.:]\d+)?)>([^<]*)/g),
      ].map(([, m, s, text]) => ({ time: at(m, s) + offset, text }));
      const text = rest.replace(/<\d+:\d{1,2}(?:[.:]\d+)?>/g, "");
      return stamps.map(([, m, s]) => ({
        time: at(m, s) + offset,
        text,
        words: words.length ? words : undefined,
      }));
    })
    .sort((a, b) => a.time - b.time);
}
export function lyricAt(lines: readonly { time: number }[], time: number) {
  let start = 0,
    end = lines.length;
  while (start < end) {
    const center = (start + end) >>> 1;
    if (lines[center].time <= time) start = center + 1;
    else end = center;
  }
  return start - 1;
}
