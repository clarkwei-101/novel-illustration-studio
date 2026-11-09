import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { NovelDetail } from "@/components/novel-detail";

export default async function NovelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-5 pt-12">
        <NovelDetail novelId={id} />
      </main>
      <SiteFooter />
    </div>
  );
}
