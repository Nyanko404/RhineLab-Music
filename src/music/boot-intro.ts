import { bootMarkContour } from "../brand";

export interface BootIntroOptions {
  dark: boolean;
  reduced: boolean;
  onReplay?: boolean;
}

export function shouldShowBootIntro(options: BootIntroOptions): boolean {
  if (options.reduced && !options.onReplay) return false;
  if (!options.onReplay && new URLSearchParams(location.search).has("noboot"))
    return false;
  return true;
}

export function runBootIntro(
  stage: HTMLElement,
  options: BootIntroOptions,
): Promise<void> {
  if (!shouldShowBootIntro(options)) return Promise.resolve();
  stage.querySelector("#music-boot")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "music-boot";
  overlay.className = "music-boot";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "RhineLab Music 啟動序列");
  overlay.dataset.theme = options.dark ? "dark" : "light";

  overlay.innerHTML = `
    <div class="boot-intro-grid" aria-hidden="true"></div>
    <svg class="boot-intro-rings" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle class="boot-ring boot-ring-outer" cx="600" cy="360" r="270" />
      <circle class="boot-ring boot-ring-inner" cx="600" cy="360" r="196" />
      <line class="boot-axis" x1="120" y1="360" x2="1080" y2="360" />
      <line class="boot-axis" x1="600" y1="70" x2="600" y2="650" />
    </svg>
    <div class="boot-intro-center">
      <svg class="boot-intro-logo" viewBox="0 0 310 145" aria-hidden="true">
        <path class="boot-contour" d="${bootMarkContour}" pathLength="1" />
        <path class="boot-sym-plus" d="M44 70h50M69 45v50" />
        <path class="boot-sym-minus" d="M219 70h44" />
      </svg>
      <div class="boot-intro-brand">
        <div class="boot-intro-kicker mono">ACCESS // AUDIO TERMINAL INITIALIZING</div>
        <div class="boot-intro-title">RHINE LAB</div>
        <div class="boot-intro-sub">LOCAL MUSIC PLAYER · ANALYSIS <b>OS</b></div>
        <div class="boot-intro-bar" aria-hidden="true"><span></span></div>
      </div>
    </div>
    <button type="button" class="boot-intro-skip mono" data-action="boot-skip">SKIP ↗</button>
  `;

  stage.appendChild(overlay);
  void overlay.offsetWidth;
  overlay.classList.add("is-active");

  return new Promise<void>((resolve) => {
    let finished = false;
    let dismissTimer = 0;
    let removeTimer = 0;
    const ac = new AbortController();

    const cleanup = () => {
      window.clearTimeout(dismissTimer);
      window.clearTimeout(removeTimer);
      ac.abort();
    };

    const close = () => {
      if (finished) return;
      finished = true;
      cleanup();
      overlay.classList.add("is-leaving");
      removeTimer = window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 240);
    };

    overlay.addEventListener(
      "click",
      () => close(),
      { signal: ac.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" ||
          event.key === " " ||
          event.key === "Enter"
        ) {
          event.preventDefault();
          close();
        }
      },
      { signal: ac.signal },
    );

    const holdMs = options.reduced ? 400 : 1450;
    dismissTimer = window.setTimeout(close, holdMs);
  });
}
