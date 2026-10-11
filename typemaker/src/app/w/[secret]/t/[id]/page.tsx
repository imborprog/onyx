import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Editor from "@/components/Editor";
import { appUrl, BRAND, PLAN_LIMITS } from "@/lib/config";
import { effectivePlan, getTestForWorkspace, getWorkspaceBySecret, listLeads, testStats } from "@/lib/repo";
import { RememberWorkspace } from "@/components/WorkspaceBits";

export const metadata: Metadata = { title: "테스트 편집", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditorPage({ params, searchParams }: { params: Promise<{ secret: string; id: string }>; searchParams: Promise<{ notice?: string; new?: string }> }) {
  const { secret, id } = await params;
  const sp = await searchParams;
  const ws = await getWorkspaceBySecret(secret);
  if (!ws) notFound();
  const test = await getTestForWorkspace(ws.id, id);
  if (!test) notFound();
  const plan = effectivePlan(ws);
  const [stats, leads] = await Promise.all([testStats(test.id), listLeads(test.id, ws.id, plan)]);

  return (
    <div className="container" style={{ paddingBlock: 28 }}>
      <RememberWorkspace secret={secret} brandName={ws.brand_name} email={ws.owner_email} />
      <div className="stack">
        <Link href={`/w/${secret}`} className="small muted">← 내 테스트</Link>
        {sp.notice === "fallback" ? <div className="notice">AI 응답이 불안정해 기본 템플릿으로 초안을 만들었어요. 문구를 직접 다듬어 주세요.</div> : null}
        {sp.new ? <div className="notice">초안이 완성됐어요! 문구를 확인하고 마음에 들면 <b>발행하기</b>를 눌러 주세요.</div> : null}
        <Editor
          secret={secret}
          testId={test.id}
          slug={test.slug}
          initialStatus={test.status}
          initialContent={test.content}
          initialSettings={test.settings}
          plan={plan}
          watermark={PLAN_LIMITS[plan].watermark}
          isHouse={ws.is_house}
          brandName={BRAND.name}
          stats={stats}
          leads={leads.rows.map((l) => ({ ...l, created_at: new Date(l.created_at).toISOString() }))}
          leadsHidden={leads.hidden}
          leadsTotal={leads.total}
          publicUrl={`${appUrl()}/t/${test.slug}`}
        />
      </div>
    </div>
  );
}
