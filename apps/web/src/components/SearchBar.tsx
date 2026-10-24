// The first thing on the page: one box that answers "can I ride X today?".
// Typing and voice both feed the same query.

import { useId } from "react";
import { useSpeechInput } from "../useSpeechInput";

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const voice = useSpeechInput(onChange);

  return (
    <div className="search">
      <form
        role="search"
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          // Close the phone keyboard so the results are visible.
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search trails
        </label>
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={voice.listening ? "Listening…" : "Search a trail or area"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        {voice.supported && (
          <button
            type="button"
            className={`icon-btn mic${voice.listening ? " is-listening" : ""}`}
            aria-label={voice.listening ? "Stop voice search" : "Search by voice"}
            aria-pressed={voice.listening}
            onClick={voice.listening ? voice.stop : voice.start}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
      </form>
      {voice.error && (
        <p className="search-error" role="alert">
          {voice.error}
        </p>
      )}
    </div>
  );
}
