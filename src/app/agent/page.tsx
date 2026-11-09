import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { AgentGuide } from "@/components/agent-guide";

export default function AgentPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/agent" />
      <main className="mx-auto max-w-7xl px-5 pt-12">
        <AgentGuide />
      </main>
      <SiteFooter />
    </div>
  );
}
