import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTicketByToken } from "@/lib/repo";
import { ReplyForm } from "@/components/SupportForms";

export const metadata: Metadata = { title: "문의 내역", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS = { open: "확인 중", answered: "답변 완료", escalated: "담당자 확인 중", closed: "종료" } as const;
const ROLE = { customer: "나", ai: "자동 답변", operator: "담당자" } as const;

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTicketByToken(token);
  if (!t) notFound();
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <Link href="/support" className="small muted">← 고객지원</Link>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 24 }}>{t.subject}</h1>
          <div className="row small"><span className={t.status === "answered" ? "pill green" : "pill gray"}>{STATUS[t.status]}</span><span className="muted">{new Date(t.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span></div>
          <p className="tiny muted">이 페이지 주소를 저장해 두면 언제든 답변을 확인할 수 있어요.</p>
        </div>
        <div className="thread">
          {t.messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="tiny" style={{ opacity: 0.7, marginBottom: 4 }}>{ROLE[m.role]} · {new Date(m.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</div>
              {m.body}
            </div>
          ))}
        </div>
        {t.status !== "closed" ? <ReplyForm token={token} /> : <p className="muted small">종료된 문의예요. 새 문의를 남겨 주세요.</p>}
      </div>
    </div>
  );
}
