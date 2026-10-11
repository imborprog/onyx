import type { Metadata } from "next";
import Link from "next/link";
import { ForgetUrlSecret } from "@/components/WorkspaceBits";
import { BRAND, PLAN_LIMITS, PRODUCTS, type ProductId } from "@/lib/config";

export const metadata: Metadata = { title: "요금", description: "무료로 시작하고 필요할 때만 결제하세요. 자동 갱신 없는 이용권." };

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const ROWS: { label: string; free: string; pro: string; agency: string }[] = [
  { label: "테스트 제작·발행", free: "무제한", pro: "무제한", agency: "무제한" },
  { label: "AI 새로 만들기", free: `하루 ${PLAN_LIMITS.free.aiGenerationsPerDay}회`, pro: `하루 ${PLAN_LIMITS.pro.aiGenerationsPerDay}회`, agency: `하루 ${PLAN_LIMITS.agency.aiGenerationsPerDay}회` },
  { label: `결과 화면 ${BRAND.name} 표시`, free: "표시", pro: "없음", agency: "없음" },
  { label: "리드 열람·CSV", free: `${PLAN_LIMITS.free.visibleLeads}건까지`, pro: "전체", agency: "전체" },
  { label: "결과별 쿠폰·버튼", free: "가능", pro: "가능", agency: "가능" },
  { label: "고객지원", free: "기본", pro: "기본", agency: "우선" },
];

const ORDER: ProductId[] = ["pro_month", "pro_year", "agency_month", "campaign"];

/** Coming from a dashboard, the workspace travels on to the checkout so the plan lands on that workspace. */
function checkoutHref(id: ProductId, ws: string | null): string {
  return `/checkout?product=${id}${ws ? `&ws=${ws}` : ""}`;
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ ws?: string | string[] }> }) {
  const raw = (await searchParams).ws;
  const ws = typeof raw === "string" && /^[a-f0-9]{20,64}$/.test(raw) ? raw : null;
  return (
    <div className="container" style={{ paddingBlock: 40 }}>
      {ws ? <ForgetUrlSecret /> : null}
      <div className="stack-lg">
        <div className="stack">
          <h1 className="display" style={{ fontSize: 36 }}>필요할 때만 결제하세요</h1>
          <p className="muted">모든 상품은 자동 갱신되지 않는 이용권이에요. 결제 후 7일 이내, 유료 기능을 쓰기 전이면 전액 환불해 드려요.</p>
        </div>

        <div className="grid-2">
          {ORDER.map((id) => {
            const p = PRODUCTS[id];
            return (
              <div key={id} className="card stack" style={id === "pro_month" ? { borderColor: "var(--accent)", borderWidth: 2 } : undefined}>
                <div className="row between">
                  <b style={{ fontSize: 18 }}>{p.name}</b>
                  {id === "pro_month" ? <span className="pill">가장 많이 선택</span> : null}
                  {id === "campaign" ? <span className="pill blue">기획 대행 포함</span> : null}
                </div>
                <p className="display num" style={{ fontSize: 32 }}>{won(p.amount)}</p>
                <p className="muted small">{p.blurb}</p>
                <Link href={checkoutHref(id, ws)} className={id === "pro_month" ? "btn btn-primary" : "btn btn-ghost"}>구매하기</Link>
              </div>
            );
          })}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>기능</th><th>무료</th><th>프로</th><th>대행사</th></tr></thead>
            <tbody>
              {ROWS.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.free}</td><td>{r.pro}</td><td>{r.agency}</td></tr>)}
            </tbody>
          </table>
        </div>

        <div className="card row between">
          <span><b>세금계산서·계좌이체가 필요하신가요?</b><br /><span className="small muted">사업자 정보를 남겨 주시면 담당자가 결제 안내를 보내 드려요.</span></span>
          <Link href="/contact?product=pro_month" className="btn btn-ghost">도입 문의</Link>
        </div>
      </div>
    </div>
  );
}
