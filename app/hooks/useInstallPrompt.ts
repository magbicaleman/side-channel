import { useEffect, useState } from "react";

// TypeScript Shim for the non-standard event
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function useInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia(
        "(display-mode: standalone)"
      ).matches;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    
    // Listen for changes in display mode
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mediaQuery.addEventListener("change", handleChange);

    // Listen for the install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setInstallEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  const promptToInstall = async () => {
    if (!installEvent) return;
    
    // Show the install prompt
    await installEvent.prompt();
    
    // Wait for the user to respond to the prompt
    // We don't really need to do anything with the choice result for now
    // const choiceResult = await installEvent.userChoice;
    
    // Clear the saved event since it can't be used again
    setInstallEvent(null);
  };

  return { installEvent, isStandalone, promptToInstall };
}
