// Voice search with the browser's Web Speech API, where it exists (Chrome,
// Edge, Safari). The mic button only shows when this is supported. Note for
// the privacy copy: Chrome sends the audio to Google for recognition.

import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_COPY: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in your browser settings.",
  "service-not-allowed": "Voice search is not available in this browser.",
  "no-speech": "Didn't catch that. Tap the mic and try again.",
  "audio-capture": "No microphone found.",
  network: "Voice search needs a connection.",
};

export function useSpeechInput(onText: (text: string) => void) {
  const supported = recognitionCtor() !== null;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => recRef.current?.abort(), []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0].transcript;
      onTextRef.current(text.trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(ERROR_COPY[e.error] ?? "Voice search stopped.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError("Voice search could not start.");
    }
  }, []);

  return { supported, listening, error, start, stop };
}
