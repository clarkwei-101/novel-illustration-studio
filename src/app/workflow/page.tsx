import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { WorkflowView } from "@/components/workflow-view";

export default function WorkflowPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/workflow" />
      <main className="mx-auto max-w-7xl px-5 pt-12">
        <WorkflowView />
      </main>
      <SiteFooter />
    </div>
  );
}
