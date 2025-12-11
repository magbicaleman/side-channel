import { Form, redirect } from "react-router";
import { toast } from "sonner";
import { useEffect } from "react";
import type { Route } from "./+types/_index";
import { Button } from "~/components/ui/button";
import { ModeToggle } from "~/components/mode-toggle";
import { ArrowRight, AudioWaveform } from "lucide-react";
import { useInstallPrompt } from "~/hooks/useInstallPrompt";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "SideChannel" },
    { name: "description", content: "Disposable Voice Chat" },
  ];
};

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  // ... (rest of action remains same)
  const roomId = crypto.randomUUID();
  return redirect(`/r/${roomId}`);
}

export default function Home() {
  const { installEvent, isStandalone, promptToInstall } = useInstallPrompt();
  // Use sessionStorage to ensure we don't spam the user on every refresh within the same tab session,
  // but allow it to reappear if they close and reopen the tab/browser.
  // We can't rely just on a ref because the component remounts on refresh.
  // React StrictMode might also double-invoke effects in dev, so we need to be careful.

  useEffect(() => {
    // Check if we already showed the prompt in this session
    const hasShownPrompt = sessionStorage.getItem("hasShownInstallPrompt");

    if (installEvent && !isStandalone && !hasShownPrompt) {
      toast("Install SideChannel for the best experience.", {
        action: {
          label: "Install",
          onClick: () => promptToInstall(),
        },
        duration: 10000, // 10 seconds
        onDismiss: () => {
             // Optional: track dismissal if needed
        },
        onAutoClose: () => {
             // Optional: track auto close
        }
      });
      sessionStorage.setItem("hasShownInstallPrompt", "true");
    }
  }, [installEvent, isStandalone, promptToInstall]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background relative selection:bg-primary/10">
      
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-muted/50 via-background to-background opacity-80" />
      
      {/* Decorative Elements */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5" />

      {/* Theme Toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ModeToggle />
      </div>

      <div className="relative z-10 flex flex-col items-center space-y-8 animate-in fade-in zoom-in-95 duration-700">
        
        {/* Logo Icon */}
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-900 shadow-2xl ring-1 ring-white/10">
           <AudioWaveform className="h-10 w-10 text-[#C5F74F]" />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter text-foreground sm:text-5xl md:text-6xl">
            SideChannel
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl font-light tracking-wide max-w-[600px]">
            Disposable, Peer-to-Peer Voice Chat.
          </p>
        </div>
        
        <Form method="post" viewTransition>
          <Button 
            size="lg" 
            type="submit" 
            className="btn-premium group h-14 px-8 text-xl rounded-full"
          >
            Create Room
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>
        </Form>
      </div>
      
       {/* Footer */}
       <div className="absolute bottom-8 text-neutral-600 text-sm">
          <p>No Login • No Logs • Just Talk</p>
       </div>
    </div>
  );
}
