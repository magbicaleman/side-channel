import { Form, redirect } from "react-router";
import { Button } from "~/components/ui/button";
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
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">SideChannel</h1>
        <p className="text-muted-foreground">Disposable, Peer-to-Peer Voice Chat.</p>
        
        <Form method="post">
          <Button size="lg" type="submit">
            Create Room
          </Button>
        </Form>
      </div>
    </div>
  );
}
