import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { appUrl, PLAN_LIMITS } from "@/lib/config";
import { effectivePlan, getWorkspaceBySecret, listGenerationRequests, listTests } from "@/lib/repo";
import { CopyButton, ProfileForm, RememberWorkspace } from "@/components/WorkspaceBits";

export const metadata: Metadata = { title: "내 테스트", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PLAN_LABEL = { free: "무료", pro: "프로", agency: "대행사" } as const;
const STATUS_LABEL = { draft: "초안", published: "발행됨", archived: "보관" } as const;

// Server components render in UTC on Vercel; dates are always shown in Korean time.
function kstDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ secret: string }>; searchParams: Promise<{ queued?: string; paid?: string }> }) {
  const { secret } = await params;
  const sp = await searchParams;
  const ws = await getWorkspaceBySecret(secret);
  if (!ws) notFound();
  const [tests, requests] = await Promise.all([listTests(ws.id), listGenerationRequests(ws.id)]);
  const plan = effectivePlan(ws);
  const dashUrl = `${appUrl()}/w/${secret}`;

  return (
    <div className="container" style={{ paddingBlock: 32 }}>
      <RememberWorkspace secret={secret} brandName={ws.brand_name} email={ws.owner_email} />
      <div className="stack-lg">
        <div className="row between">
          <div className="stack" style={{ gap: 6 }}>
            <h1 className="display" style={{ fontSize: 32 }}>{ws.brand_name ? `${ws.brand_name}의 테스트` : "내 테스트"}</h1>
            <div className="row small">
              <span className={plan === "free" ? "pill gray" : "pill green"}>{PLAN_LABEL[plan]} 플랜</span>
              {plan !== "free" && ws.plan_expires_at ? <span className="muted">{kstDate(ws.plan_expires_at)}까지</span> : null}
              <span className="muted">AI 생성 하루 {PLAN_LIMITS[plan].aiGenerationsPerDay}회</span>
            </div>
          </div>
          <div className="row">
            {plan === "free" ? <Link href="/pricing" className="btn btn-ghost">업그레이드</Link> : null}
            <Link href="/create" className="btn btn-primary">새 테스트 만들기</Link>
          </div>
        </div>

        {sp.paid ? <div className="notice">결제가 완료됐어요. 고맙습니다! 플랜이 바로 적용됐어요.</div> : null}
        {sp.queued || requests.some((r) => r.status === "queued") ? (
          <div className="notice">운영팀이 테스트 초안을 기획하고 있어요. 보통 24시간 안에 이메일로 알려 드리고, 완성되면 이 화면에 나타나요.</div>
        ) : null}

        <div className="card stack">
          <div className="row between">
            <b>관리 링크</b>
            <CopyButton text={dashUrl} label="링크 복사" />
          </div>
          <p className="small muted">이 링크가 곧 로그인이에요. 북마크해 두고 다른 사람과 공유하지 마세요.</p>
        </div>

        {tests.length === 0 ? (
          <div className="card center stack" style={{ paddingBlock: 40 }}>
            <b>아직 만든 테스트가 없어요</b>
            <div><Link href="/create" className="btn btn-primary">첫 테스트 만들기</Link></div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>테스트</th><th>상태</th><th className="num">조회</th><th className="num">완료</th><th className="num">리드</th><th /></tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/w/${secret}/t/${t.id}`}><b>{t.title}</b></Link><div className="tiny muted">{kstDate(t.created_at)}</div></td>
                    <td><span className={t.status === "published" ? "pill green" : "pill gray"}>{STATUS_LABEL[t.status]}</span></td>
                    <td className="num">{t.views.toLocaleString("ko-KR")}</td>
                    <td className="num">{t.completes.toLocaleString("ko-KR")}</td>
                    <td className="num">{t.leads.toLocaleString("ko-KR")}</td>
                    <td className="row" style={{ justifyContent: "flex-end" }}>
                      <Link href={`/w/${secret}/t/${t.id}`} className="btn btn-ghost btn-sm">편집</Link>
                      {t.status === "published" ? <Link href={`/t/${t.slug}`} className="btn btn-ghost btn-sm" target="_blank">보기</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card stack">
          <b>계정 정보</b>
          <ProfileForm secret={secret} email={ws.owner_email ?? ""} brandName={ws.brand_name ?? ""} marketingOptIn={ws.marketing_opt_in} />
        </div>

        <p className="small muted">도움이 필요하면 <Link href="/support">고객지원</Link>에 남겨 주세요. 보통 몇 시간 안에 답변드려요.</p>
      </div>
    </div>
  );
}
