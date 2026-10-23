// "Is this right?" single-focus modal (spec §6.1): Yes / Wetter / Drier, the
// optional §6.1 tags, one tap to send. The Cloudflare Turnstile widget runs
// before the verdict buttons enable; the token is verified again server-side.
//
// Sitekey: VITE_TURNSTILE_SITEKEY, defaulting to Cloudflare's published
// always-pass TEST sitekey for local dev. The real sitekey is created
// manually at M7, never by a ship run.

import { useEffect, useRef, useState } from "react";
import { REPORTS, type ReportVerdict } from "@trail-conditions/model";
import { ApiError, postReport } from "../api";
import { getDeviceId } from "../device";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const SITEKEY =
  (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ??
  "1x00000000000000000000AA"; // Cloudflare's always-pass TEST sitekey

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile]",
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener(
      "load",
      () =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error("turnstile script loaded without its API")),
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("turnstile script failed to load")),
      { once: true },
    );
    if (!existing) {
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.dataset.turnstile = "true";
      document.head.appendChild(script);
    }
  });
}

type Phase = "idle" | "submitting" | "success";

export function ReportModal({
  trailId,
  onClose,
  onSubmitted,
}: {
  trailId: string;
  onClose: () => void;
  /** Called once after a successful submit, so the page can refetch. */
  onSubmitted: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [widgetFailed, setWidgetFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const widgetRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Mount the Turnstile widget once.
  useEffect(() => {
    let cancelled = false;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;
    loadTurnstile().then(
      (turnstile) => {
        if (cancelled || !widgetRef.current) return;
        api = turnstile;
        widgetId = turnstile.render(widgetRef.current, {
          sitekey: SITEKEY,
          callback: (t) => setToken(t),
          "expired-callback": () => setToken(null),
          "error-callback": () => setWidgetFailed(true),
        });
      },
      () => {
        if (!cancelled) setWidgetFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (api && widgetId !== null) api.remove(widgetId);
    };
  }, []);

  // Single-focus: take focus on open, trap Tab, close on Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        "button, input, [tabindex]:not([tabindex='-1'])",
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleTag = (tag: string) =>
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );

  const submit = async (verdict: ReportVerdict) => {
    if (!token || phase !== "idle") return;
    setPhase("submitting");
    setError(null);
    try {
      await postReport({
        trailId,
        verdict,
        tags,
        deviceId: getDeviceId(window.localStorage),
        turnstileToken: token,
      });
      setPhase("success");
      onSubmitted();
    } catch (err) {
      setPhase("idle");
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't send your report. Check your connection and try again.",
      );
    }
  };

  const verdictsDisabled = !token || widgetFailed || phase === "submitting";

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        {phase === "success" ? (
          <>
            <h2 id="report-modal-title">Thanks — report saved</h2>
            <p className="modal-hint">
              The reports count updates now; the confidence marker picks it up
              at the next score update.
            </p>
            <button type="button" className="report-btn" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <h2 id="report-modal-title">Is this right?</h2>
            <p className="modal-hint">One tap sends your report.</p>
            <fieldset className="tag-set">
              <legend>Optional tags</legend>
              {REPORTS.tags.map((tag) => (
                <label key={tag} className="tag-chip">
                  <input
                    type="checkbox"
                    checked={tags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                  />
                  {tag}
                </label>
              ))}
            </fieldset>
            <div className="verdicts">
              <button
                type="button"
                disabled={verdictsDisabled}
                onClick={() => void submit("yes")}
              >
                Yes
              </button>
              <button
                type="button"
                disabled={verdictsDisabled}
                onClick={() => void submit("wetter")}
              >
                Wetter
              </button>
              <button
                type="button"
                disabled={verdictsDisabled}
                onClick={() => void submit("drier")}
              >
                Drier
              </button>
            </div>
            <div ref={widgetRef} className="turnstile-slot" />
            {phase === "submitting" && (
              <p className="modal-hint" role="status">
                Sending…
              </p>
            )}
            {!token && !widgetFailed && phase === "idle" && (
              <p className="modal-hint" role="status">
                Checking you're human…
              </p>
            )}
            {widgetFailed && (
              <p className="modal-error">
                The human check didn't load. Close this and try again.
              </p>
            )}
            {error && <p className="modal-error">{error}</p>}
            <button type="button" className="modal-cancel" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
