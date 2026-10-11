import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, BUSINESS } from "@/lib/config";

export const metadata: Metadata = { title: "이용약관" };

/** NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE (YYYY-MM-DD) as a Korean date, or null when it is unset or not a real date. */
function effectiveDate(raw: string | undefined): string | null {
  const ymd = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const date = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) !== ymd) return null;
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

const H2 = { fontSize: 20 } as const;

export default function TermsPage() {
  const owner = BUSINESS.companyName || BRAND.name;
  const effective = effectiveDate(process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE);
  const draft = !effective || !BUSINESS.companyName;

  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <article className="stack">
        <h1 className="display" style={{ fontSize: 32 }}>이용약관</h1>
        {draft ? (
          <p className="notice" role="note">
            <b>시행 전 초안</b> · 이 약관은 아직 시행되지 않은 초안이에요. 사업자 정보와 시행일이 정해지면 이 표시가 사라지고 아래 내용대로 시행됩니다.
          </p>
        ) : null}

        <h2 style={H2}>제1조 (목적)</h2>
        <p>이 약관은 {owner}(이하 &ldquo;회사&rdquo;)가 제공하는 {BRAND.name} 서비스(이하 &ldquo;서비스&rdquo;)의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.</p>

        <h2 style={H2}>제2조 (서비스 내용)</h2>
        <p>서비스는 심리테스트·유형 테스트를 AI 등으로 제작·편집·발행하고, 참여 통계, 결과 공유, 참여자 연락처 수집, 쿠폰 표시 기능을 제공합니다. 별도 회원가입 없이 관리 링크로 이용하며, 관리 링크의 보관 책임은 이용자에게 있습니다. 관리 링크를 잃어버리면 워크스페이스에 등록한 이메일로만 다시 보내 드리며, 이메일을 등록하지 않았거나 지워진 경우에는 복구할 수 없습니다.</p>
        <p>회사는 고객 문의 답변, 도입 문의 회신, 제작 대행 등 운영 업무의 상당 부분을 AI(Anthropic의 Claude)로 처리합니다. 환불·결제 취소·이용권 무상 부여·개인정보 삭제는 AI가 결정하지 않고 사람이 확인한 뒤 처리합니다.</p>

        <h2 style={H2}>제3조 (유료 이용권)</h2>
        <p>유료 상품은 정해진 기간 동안 기능을 이용하는 이용권이며 자동으로 갱신되지 않습니다. 가격과 제공 내용은 요금 페이지에 표시된 바에 따릅니다.</p>

        <h2 style={H2}>제4조 (청약철회와 환불)</h2>
        <p>이용자는 결제일로부터 7일 이내에 청약을 철회할 수 있습니다. 다만 유료 기능(워터마크 없이 발행, 리드 전체 열람·다운로드, 기획 대행 착수)을 이미 이용한 경우 이용 기간 또는 제공된 용역에 해당하는 금액을 공제하고 환불합니다.</p>
        <p>환불은 고객지원에서 &lsquo;환불&rsquo; 유형으로 요청합니다. 환불 여부와 금액은 사람이 결제·이용 내역을 직접 확인해 정하며, AI 자동 답변이나 AI 운영자의 답변은 환불을 약속하거나 거절하는 효력이 없습니다. 회사는 청약철회가 확인된 날부터 3영업일 이내에 결제 수단(카드 결제 취소 또는 계좌 환급)으로 환불합니다. 환불하면 그 결제로 늘어난 이용 기간이 줄어들고, 남는 기간이 없으면 무료 플랜으로 바뀝니다. 캠페인 패스를 환불하면 아직 시작하지 않은 기획 대행도 취소됩니다.</p>

        <h2 style={H2}>제5조 (이용자의 의무)</h2>
        <p>이용자는 다음 콘텐츠를 만들거나 배포해서는 안 됩니다: 법령 위반, 타인의 권리(저작권·상표권·초상권) 침해, 혐오·차별·선정적 표현, 의학적·심리학적 진단으로 오인될 수 있는 내용, 동의 없는 광고성 정보 발송에 쓰기 위한 개인정보 수집.</p>

        <h2 style={H2}>제6조 (생성 콘텐츠와 참여자 정보)</h2>
        <p>AI가 생성한 초안은 이용자가 검토·수정 후 발행하며, 발행한 콘텐츠에 대한 책임은 이용자에게 있습니다.</p>
        <p>리드 수집 기능으로 받은 참여자 정보의 개인정보처리자는 이용자(테스트 제작자)이며, 회사는 이용자의 위탁을 받아 보관하는 수탁자입니다. 이용자는 관련 법령(개인정보 보호법, 정보통신망법 등)에 따라 참여자 정보를 처리해야 하고, 이용자가 정한 보관 기간이 지나면 회사가 자동으로 삭제합니다. 참여자가 회사에 광고 수신 동의 철회를 요청하면 회사는 해당 리드의 동의를 철회로 바꾸고 이용자에게 이메일로 알리며, 이용자는 이미 내려받은 명단과 발송 도구에서도 그 연락처를 지체 없이 빼야 합니다.</p>

        <h2 style={H2}>제7조 (광고성 정보)</h2>
        <p>회사는 수신에 동의한 이용자에게만 새 기능·할인 안내를 보내고, 동의 후 2년이 지나면 다시 동의를 확인하기 전까지 보내지 않습니다. 이용자는 대시보드에서 수신 동의를 끄거나 고객지원의 &lsquo;광고 수신거부&rsquo; 유형으로 언제든 수신을 거부할 수 있습니다.</p>

        <h2 style={H2}>제8조 (서비스 변경·중단)</h2>
        <p>회사는 운영상·기술상 필요에 따라 서비스를 변경하거나 중단할 수 있으며, 유료 이용 중인 이용자에게는 사전에 알리고 남은 기간에 해당하는 금액을 환불합니다.</p>

        <h2 style={H2}>제9조 (책임 제한)</h2>
        <p>회사는 천재지변, 이용자의 관리 링크 유출 등 회사의 귀책이 없는 사유로 발생한 손해에 책임지지 않습니다. 테스트 결과는 재미를 위한 콘텐츠이며 어떠한 진단이나 판단의 근거가 되지 않습니다. AI가 만든 초안과 답변에는 오류가 있을 수 있으니, 중요한 내용은 고객지원에 다시 확인해 주세요.</p>

        <h2 style={H2}>제10조 (개인정보 보호)</h2>
        <p>회사가 처리하는 개인정보의 항목, 목적, 보유 기간, 처리 위탁과 국외 이전은 <Link href="/legal/privacy">개인정보처리방침</Link>에 따릅니다.</p>

        <h2 style={H2}>제11조 (분쟁 해결)</h2>
        <p>분쟁은 대한민국 법을 따르며, 관할 법원은 민사소송법에 따릅니다.</p>
        <p className="small muted">시행일: {effective ?? "정해지지 않음(시행 전 초안)"}</p>
      </article>
    </div>
  );
}
