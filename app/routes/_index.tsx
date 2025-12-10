import { Form, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { AudioWaveform } from "lucide-react";
import type { Route } from "./+types/_index";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "SideChannel" },
    { name: "description", content: "Disposable Voice Chat" },
  ];
};

export const action = async () => {
  const uuid = crypto.randomUUID();
  return redirect(`/r/${uuid}`);
};

export default function Index() {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center bg-neutral-950 overflow-hidden">
      
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-900 via-neutral-950 to-neutral-950 opacity-80" />
      
      {/* Decorative Elements */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5" />

      <div className="relative z-10 flex flex-col items-center space-y-8 animate-in fade-in zoom-in-95 duration-700">
        
        {/* Logo Icon */}
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-900 shadow-2xl ring-1 ring-white/10">
           <AudioWaveform className="h-10 w-10 text-[#C5F74F]" />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter text-white sm:text-5xl md:text-6xl">
            SideChannel
          </h1>
          <p className="text-neutral-400 text-lg sm:text-xl font-light tracking-wide max-w-[600px]">
            Disposable, Peer-to-Peer Voice Chat.
          </p>
        </div>
        
        <Form method="post" viewTransition>
          <Button 
            size="lg" 
            type="submit" 
            className="h-14 px-8 text-lg rounded-full bg-white text-black hover:bg-neutral-200 transition-transform active:scale-95 duration-200"
          >
            Create Room
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
