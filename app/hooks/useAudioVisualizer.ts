import { useEffect, useRef, type RefObject } from "react";

/**
 * useAudioVisualizer
 * 
 * Visualizes audio volume for a given MediaStream by updating a CSS variable --volume
 * on the provided visualizerRef. Uses a "Sidechain" approach by cloning the stream
 * to avoid interfering with any existing audio playback infrastructure.
 */
export function useAudioVisualizer(
  stream: MediaStream | undefined,
  visualizerRef: RefObject<HTMLDivElement | null>
) {
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) return;
    if (stream.getAudioTracks().length === 0) return;

    // 1. Setup Audio Pipeline.
    let audioContext: AudioContext;
    
    try {
      // @ts-expect-error - webkitAudioContext fallback
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return;
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const gain = audioContext.createGain();
    
    analyser.fftSize = 64; 
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Ensure the audio graph is actually "pulled" by connecting (silently) to destination.
    // Without a destination, some browsers will stop processing after the initial tick.
    gain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(audioContext.destination);

    let disposed = false;

    const tryResume = () => {
      if (disposed) return;
      if (audioContext.state !== "suspended") return;
      audioContext.resume().catch(() => {
        // Autoplay policy may block resume until a user gesture.
      });
    };

    // WebAudio often needs a user gesture to resume (especially on first visit / local dev).
    window.addEventListener("pointerdown", tryResume, { passive: true });
    window.addEventListener("keydown", tryResume);
    window.addEventListener("touchstart", tryResume, { passive: true });
    tryResume();

    const updateVolume = () => {
      animationFrameRef.current = requestAnimationFrame(updateVolume);

      if (!visualizerRef.current) return;

      tryResume();
      if (audioContext.state !== "running") return;

      analyser.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      
      const rms = Math.sqrt(sumSquares / bufferLength);
      
      /**
       * Mapping RMS to Scale:
       * 0.0 RMS -> 1.0 Scale
       * 0.05 RMS (standard talking) -> ~1.5 Scale (rms * 10)
       * Limit scale to 1.8 max.
       */
      const scale = 1 + (Math.min(rms * 10, 0.8)); 

      // Apply directly to DOM to avoid React override and visual lag
      visualizerRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      
      // Visual feedback via opacity for more depth
      visualizerRef.current.style.opacity = rms > 0.05 ? "1" : "0.4";
    };

    updateVolume();

    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", tryResume);
      window.removeEventListener("keydown", tryResume);
      window.removeEventListener("touchstart", tryResume);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      try {
        source.disconnect();
        analyser.disconnect();
        gain.disconnect();
      } catch {
        // ignore disconnect errors during teardown
      }
      if (audioContext.state !== 'closed') {
        audioContext.close().catch(console.error);
      }
    };
  }, [stream, visualizerRef]); 
}
