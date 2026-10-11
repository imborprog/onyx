import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, BUSINESS } from "@/lib/config";

export const metadata: Metadata = { title: "개인정보처리방침" };

/** NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE (YYYY-MM-DD) as a Korean date, or null when it is unset or not a real date. */
function effectiveDate(raw: string | undefined): string | null {
  const ymd = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const date = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) !== ymd) return null;
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

const H2 = { fontSize: 20 } as const;

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// Retention below must match what repo.purgeRetention() enforces (contract C7) and ops/PLAYBOOK.md §7.
export default function PrivacyPage() {
  const owner = BUSINESS.companyName || BRAND.name;
  const effective = effectiveDate(process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE);
  const officer = (process.env.NEXT_PUBLIC_PRIVACY_OFFICER ?? "").trim();
  const officerEmail = BRAND.supportEmail.trim();
  // Without these the policy cannot be in force, so it says so instead of showing placeholders.
  const draft = !effective || !officer || !officerEmail || !BUSINESS.companyName;

  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <article className="stack">
        <h1 className="display" style={{ fontSize: 32 }}>개인정보처리방침</h1>
        {draft ? (
          <p className="notice" role="note">
            <b>시행 전 초안</b> · 이 방침은 아직 시행되지 않은 초안이에요. 사업자 정보, 개인정보 보호책임자, 시행일이 정해지면 이 표시가 사라지고 아래 내용대로 시행됩니다.
          </p>
        ) : null}
        <p>{owner}(이하 &ldquo;회사&rdquo;)는 「개인정보 보호법」 등 관련 법령에 따라 {BRAND.name} 서비스 이용자의 개인정보를 보호하고 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보처리방침을 둡니다.</p>

        <div className="card card-tight stack">
          <b>한눈에 보기</b>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>회원가입 없이 이용하며, 테스트 제작자의 이메일은 선택 항목이에요.</li>
            <li>접속 IP는 그대로 저장하지 않고 비밀 키로 만든 해시값으로만 저장하며, 90일 뒤 지워요.</li>
            <li>고객 문의·도입 문의 응대와 운영 업무는 Anthropic의 AI(Claude)가 처리해요. 환불·결제 취소·개인정보 삭제는 사람이 확인해요.</li>
            <li>테스트 참여자가 남긴 연락처(리드)의 개인정보처리자는 그 테스트를 만든 제작자예요.</li>
            <li>보관 기간이 지난 정보는 매일 자동으로 지워요.</li>
          </ul>
        </div>

        <h2 style={H2}>1. 처리하는 개인정보와 목적, 보유 기간</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>구분</th><th>항목</th><th>목적</th><th>보유 기간</th></tr></thead>
          <tbody>
            <tr>
              <td>테스트 제작자</td>
              <td>이메일(선택), 브랜드명(선택), 마지막 이용 일시, 만든 테스트, 제작 요청 내용(주제·대상·추가 요청 등)</td>
              <td>서비스 제공, 관리 링크 재발송, 제작 완료·결제 안내</td>
              <td>이메일: 마지막 이용(관리 링크 접속) 후 1년 또는 마지막 유료 결제 후 5년 중 늦은 날까지<br />테스트·브랜드명·제작 요청: 삭제를 요청할 때까지</td>
            </tr>
            <tr>
              <td>광고성 정보 수신 동의(제작자)</td>
              <td>이메일, 동의 여부, 동의 일시, 동의 경로</td>
              <td>새 기능·할인 안내</td>
              <td>동의를 철회하거나 이메일이 지워질 때까지. 동의 후 2년이 지나면 다시 동의하기 전까지 보내지 않음</td>
            </tr>
            <tr>
              <td>수신거부 목록</td>
              <td>수신거부한 이메일 또는 전화번호, 사유, 일시</td>
              <td>수신거부한 분께 다시 광고가 가지 않게 하기</td>
              <td>다시 받겠다고 요청할 때까지</td>
            </tr>
            <tr>
              <td>고객지원 문의</td>
              <td>이메일(선택), 이름(선택), 문의 유형·제목·내용과 대화 기록, 문의할 때 연결된 워크스페이스</td>
              <td>문의 답변, 처리 기록</td>
              <td>답변 완료·종료 후 마지막 메시지로부터 1년(처리 중인 문의는 처리가 끝날 때까지)</td>
            </tr>
            <tr>
              <td>도입·결제 문의</td>
              <td>이름, 회사명, 이메일, 연락처, 관심 상품, 문의 내용</td>
              <td>상담 답변, 계좌이체·세금계산서 안내</td>
              <td>마지막 처리 후 1년</td>
            </tr>
            <tr>
              <td>유료 결제</td>
              <td>결제 이메일, 주문번호, 상품, 금액, 결제·환불 일시, 결제대행사가 돌려준 승인 정보(결제수단, 카드사, 일부를 가린 카드번호 등). 카드번호 전체는 회사가 받지 않아요.</td>
              <td>결제·환불 처리, 영수증·세금계산서 발행, 거래 기록 보관</td>
              <td>5년(전자상거래법)</td>
            </tr>
            <tr>
              <td>테스트 참여 기록</td>
              <td>조회·시작·완료·공유·클릭 기록, 받은 결과, 유입 채널, 브라우저 세션 식별값(무작위 값)</td>
              <td>참여 통계, 부정 참여 방지</td>
              <td>2년</td>
            </tr>
            <tr>
              <td>접속 IP의 해시값</td>
              <td>워크스페이스, 테스트 생성 정보, 문의, 도입 문의, 리드, 참여 기록, 생성 시도 기록에 함께 저장</td>
              <td>생성 한도 적용, 도배·부정 이용 방지</td>
              <td>저장 후 90일이 지나면 지움</td>
            </tr>
            <tr>
              <td>AI 생성 시도 기록</td>
              <td>접속 IP 해시값, 워크스페이스, 생성 종류·결과, 일시</td>
              <td>하루 생성 한도 적용, 남용 방지</td>
              <td>90일</td>
            </tr>
            <tr>
              <td>발송 메일 기록</td>
              <td>받는 이메일, 제목, 본문</td>
              <td>메일 발송, 발송 실패 확인</td>
              <td>발송·실패·취소 후 90일</td>
            </tr>
            <tr>
              <td>운영 처리 기록</td>
              <td>일부를 가린 연락처(예: ab***@example.com), 처리 내용</td>
              <td>수신거부·관리 링크 재발송 등 요청을 처리한 사실의 증빙</td>
              <td>서비스 운영 기간(연락처는 가린 형태로만 남김)</td>
            </tr>
            <tr>
              <td>테스트 참여자 연락처(리드)</td>
              <td colSpan={3}>테스트 제작자가 개인정보처리자예요. 아래 3번을 확인해 주세요.</td>
            </tr>
          </tbody>
        </table></div>
        <p className="small muted">주민등록번호 같은 고유식별정보나 민감정보는 수집하지 않아요. 문의 내용에도 적지 말아 주세요.</p>

        <h2 style={H2}>2. 접속 IP 주소</h2>
        <p>회사는 접속 IP 주소를 데이터베이스에 그대로 저장하지 않습니다. 비밀 키로 만든 단방향 해시값(HMAC-SHA256)으로 바꿔 저장하며, 키 없이는 원래 주소를 알아낼 수 없습니다. 이 해시값은 생성 한도와 도배 방지에만 쓰고, 저장한 지 90일이 지나면 지웁니다. 다만 호스팅 사업자(Vercel)는 요청을 처리하는 과정에서 IP 주소를 처리하며, 그 접속 기록은 Vercel의 정책에 따라 관리됩니다.</p>

        <h2 style={H2}>3. 테스트 참여자가 남긴 연락처(리드)</h2>
        <p>테스트 제작자가 리드 수집 기능을 켜면, 참여자가 입력한 이름·연락처·이메일, 동의 내역(개인정보 수집·이용, 광고성 정보 수신, 야간 수신, 만 14세 이상 확인)과 받은 결과는 <b>그 테스트를 만든 제작자가 개인정보처리자</b>로서 수집합니다. 수집 목적과 보유 기간은 제작자가 정해 입력 폼에 표시하며, 회사는 제작자의 위탁을 받아 보관하고 제작자에게 보여 주는 수탁자입니다.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>제작자가 정한 보관 기간(30~1095일)이 지나면 자동으로 삭제합니다. 리드와 함께 저장한 접속 IP 해시값은 90일 뒤 지웁니다.</li>
          <li>참여자는 열람·정정·삭제를 해당 제작자에게 요청하거나 회사 고객지원으로 요청할 수 있습니다. 회사로 온 요청은 사람이 확인한 뒤 처리합니다.</li>
          <li>참여자가 회사 고객지원에서 광고 수신 동의 철회를 요청하면, 회사는 일치하는 리드의 광고·야간 수신 동의를 철회로 바꾸고 연락처를 수신거부 목록에 올린 뒤, 해당 테스트 제작자에게 철회 사실과 연락처를 이메일로 알립니다. 제작자가 이미 내려받은 명단에서도 빼도록 하기 위해서입니다.</li>
        </ul>

        <h2 style={H2}>4. AI를 이용한 운영</h2>
        <p>회사는 Anthropic PBC(미국)의 AI 모델 Claude를 써서 서비스를 운영합니다. Claude가 개인정보를 처리하는 경우는 다음과 같습니다.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>AI 테스트 생성</b>: 제작자가 입력한 주제·브랜드명·대상·추가 요청을 Claude에 보내 문항을 만듭니다.</li>
          <li><b>문의 자동 답변</b>: 고객지원 문의의 제목과 내용을 Claude에 보내 답변을 만듭니다. 자주 묻는 질문으로 답할 수 있으면 보내지 않으며, 환불·개인정보 유형 문의는 자동 답변에 쓰지 않습니다.</li>
          <li>
            <b>AI 운영자</b>: Claude가 운영 도구로 데이터베이스를 조회해 고객 문의에 답하고, 도입·결제 문의에 회신하고, 제작 대행 요청을 처리하고, 광고 수신에 동의한 제작자에게 안내 메일을 씁니다. 이때 Claude는 다음 정보를 읽습니다.
            <ul style={{ paddingLeft: 18 }}>
              <li>처리 중인 고객지원 문의 전체: 이메일, 이름, 유형, 제목, 대화 내용(환불·개인정보 문의 포함)</li>
              <li>도입·결제 문의: 이름, 회사명, 이메일, 연락처, 관심 상품, 문의 내용</li>
              <li>워크스페이스 정보: 이메일, 브랜드명, 요금제와 이용 기간, 만든 테스트와 참여·리드 건수, 제작 요청 내용, 광고 수신 동의 일시</li>
              <li>메일 발송 상태: 받는 주소와 제목(본문은 제외)</li>
            </ul>
          </li>
        </ul>
        <p>운영 절차상 AI 운영자는 관리 링크, 메일 본문, 참여자 리드의 연락처 목록을 조회하지 않으며, 수신거부 요청을 처리할 때만 요청한 분이 적은 연락처로 해당 리드를 찾습니다. AI가 쓴 답변은 문의 페이지와 이메일로 그대로 전달될 수 있습니다. <b>환불·결제 취소·이용권 무상 부여·개인정보 삭제처럼 이용자의 권리·의무에 영향을 주는 결정은 AI가 하지 않고, 사람이 확인한 뒤 처리합니다.</b></p>

        <h2 style={H2}>5. 광고성 정보 수신 동의와 수신거부</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>새 기능·할인 안내는 수신에 동의한 제작자에게만 보내며, 동의한 날짜와 경로를 기록합니다. 동의하거나 철회하면 처리 결과(전송자, 일시, 처리 내용)를 이메일로 알려 드립니다.</li>
          <li>동의 후 2년이 지나면 다시 동의를 확인하기 전까지 광고를 보내지 않습니다. 대시보드에서 수신 동의를 다시 저장하면 그날부터 2년이 새로 시작됩니다.</li>
          <li>광고 메일은 제목 앞에 &lsquo;(광고)&rsquo;를 붙이고, 본문에 전송자 정보와 수신거부 방법을 적습니다.</li>
          <li>수신거부는 대시보드에서 수신 동의를 끄거나, <Link href="/support">고객지원</Link>에서 &lsquo;광고 수신거부&rsquo; 유형으로 요청하면 됩니다. 처리한 연락처는 수신거부 목록에 올려 같은 이메일로 만든 다른 워크스페이스에서도 광고가 나가지 않게 하고, 발송 대기 중인 광고도 취소합니다. 수신거부를 풀려면 본인이 고객지원으로 요청해야 하며 사람이 확인합니다.</li>
        </ul>

        <h2 style={H2}>6. 처리 위탁</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>수탁자</th><th>위탁 업무</th></tr></thead>
          <tbody>
            <tr><td>Supabase Inc.</td><td>데이터베이스 운영·보관</td></tr>
            <tr><td>Vercel Inc.</td><td>웹 서비스 호스팅, 요청 처리</td></tr>
            <tr><td>Anthropic PBC</td><td>AI 테스트 생성, 문의 자동 답변, AI 운영자를 통한 고객 응대·도입 문의 회신·제작 대행·안내 메일 작성(4번)</td></tr>
            <tr><td>Resend</td><td>이메일 발송</td></tr>
            <tr><td>토스페이먼츠(주)</td><td>카드 결제 처리</td></tr>
          </tbody>
        </table></div>

        <h2 style={H2}>7. 개인정보의 국외 이전</h2>
        <p>회사는 서비스 계약을 이행하기 위해 다음과 같이 개인정보를 국외로 이전(처리 위탁·보관)합니다. 이전받는 자의 연락처는 각 회사의 개인정보처리방침에 안내돼 있습니다.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>이전받는 자</th><th>국가</th><th>이전 항목</th><th>목적</th><th>시기·방법</th><th>보유·이용 기간</th></tr></thead>
          <tbody>
            <tr>
              <td>Supabase Inc.<br /><ExternalLink href="https://supabase.com/privacy">개인정보 문의처</ExternalLink></td>
              <td>미국(운영사 소재지)</td>
              <td>1번 표의 모든 항목과 리드</td>
              <td>데이터베이스 보관</td>
              <td>서비스를 이용할 때마다 암호화된 네트워크로 전송·저장</td>
              <td>1번·3번의 보유 기간과 같음</td>
            </tr>
            <tr>
              <td>Vercel Inc.<br /><ExternalLink href="https://vercel.com/legal/privacy-policy">개인정보 문의처</ExternalLink></td>
              <td>미국 등(요청 처리 서버와 전송망 소재지)</td>
              <td>서비스 이용 중 주고받는 정보, 접속 IP 주소</td>
              <td>웹 서비스 제공</td>
              <td>서비스를 이용할 때마다 암호화된 네트워크로 전송</td>
              <td>요청을 처리하는 동안. 접속 기록은 Vercel의 보관 정책에 따름</td>
            </tr>
            <tr>
              <td>Anthropic PBC<br /><ExternalLink href="https://www.anthropic.com/legal/privacy">개인정보 문의처</ExternalLink></td>
              <td>미국</td>
              <td>AI 생성 입력(주제·브랜드명·대상·추가 요청), 문의 제목·내용, AI 운영자가 읽는 정보(4번: 문의자 이메일·이름·대화 내용, 도입 문의자 이름·회사명·이메일·연락처·문의 내용, 제작자 이메일·브랜드명·요금제·테스트 정보)</td>
              <td>4번의 AI 처리</td>
              <td>AI 생성·문의 접수 시, AI 운영자가 운영 작업을 할 때(매일) 암호화된 네트워크로 전송</td>
              <td>처리 후 Anthropic의 데이터 보관 정책에 따른 기간</td>
            </tr>
            <tr>
              <td>Resend<br /><ExternalLink href="https://resend.com/legal/privacy-policy">개인정보 문의처</ExternalLink></td>
              <td>미국</td>
              <td>받는 이메일 주소, 메일 제목·본문</td>
              <td>이메일 발송</td>
              <td>메일을 보낼 때 암호화된 네트워크로 전송</td>
              <td>발송 처리 후 Resend의 보관 정책에 따른 기간</td>
            </tr>
          </tbody>
        </table></div>
        <p className="small muted">국외 이전을 원하지 않으면 고객지원(&lsquo;개인정보·데이터 삭제&rsquo; 유형)이나 아래 개인정보 보호책임자 이메일로 이전 중단을 요청할 수 있습니다. 위 업체는 서비스 제공에 꼭 필요해서, 이전을 거부하면 관련 정보를 삭제하고 해당 기능(테스트 제작·관리, 문의 답변, 메일 수신)을 더 이용할 수 없습니다. 고객지원과 도입 문의는 AI가 처리하므로, 문의를 남기면 그 내용이 Anthropic으로 이전됩니다.</p>

        <h2 style={H2}>8. 제3자 제공</h2>
        <p>회사는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 법령에 근거해 수사기관 등이 적법한 절차로 요구하는 경우는 예외입니다. 리드를 테스트 제작자에게 보여 주거나 참여자의 수신 동의 철회를 제작자에게 알리는 것은 그 정보의 개인정보처리자에게 전달하는 것으로, 제3자 제공이 아닙니다.</p>

        <h2 style={H2}>9. 파기 절차와 방법</h2>
        <p>보유 기간이 지난 정보는 매일 자동으로 실행되는 삭제 작업이 복구할 수 없게 지우거나 해당 항목을 비웁니다. 이용자가 삭제를 요청하면 확인 후 지체 없이 지웁니다. 법령에 따라 보관해야 하는 결제 기록은 다른 정보와 구분해 5년간 보관한 뒤 지웁니다. 데이터베이스 백업에 남은 사본은 백업 보관 주기에 따라 순차적으로 덮어써져 사라집니다.</p>

        <h2 style={H2}>10. 이용자의 권리와 행사 방법</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>이용자는 언제든 개인정보 열람·정정·삭제·처리정지, 동의 철회, 국외 이전 중단을 요청할 수 있습니다.</li>
          <li>테스트 제작자는 대시보드에서 이메일·브랜드명을 고치거나 지우고, 광고 수신 동의를 직접 켜고 끌 수 있습니다.</li>
          <li>그 밖의 요청은 <Link href="/support">고객지원</Link>에서 &lsquo;개인정보·데이터 삭제&rsquo; 유형(광고만 그만 받으려면 &lsquo;광고 수신거부&rsquo; 유형)으로 보내거나 개인정보 보호책임자 이메일로 보내 주세요. 사람이 확인한 뒤 요청을 받은 날부터 10일 안에 처리하고 결과를 알려 드립니다.</li>
          <li>회원 계정이 없는 서비스라, 본인 확인을 위해 관리 링크를 연 브라우저에서 요청해 주시도록 안내하거나 추가 정보를 여쭤볼 수 있습니다. 법정대리인이나 위임을 받은 사람을 통해서도 요청할 수 있습니다.</li>
        </ul>

        <h2 style={H2}>11. 자동으로 수집하는 장치</h2>
        <p>회사는 광고·분석용 쿠키를 쓰지 않습니다. 다음 정보만 이용자의 브라우저 저장소에 둡니다.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>관리 링크 비밀값(localStorage): 테스트를 만든 브라우저에서 &lsquo;내 테스트&rsquo;를 바로 열기 위해서예요. 브라우저의 사이트 데이터를 지우면 사라져요.</li>
          <li>이 브라우저에서 쓴 워크스페이스 목록(localStorage): 관리 링크 비밀값과, 알아보기 위한 브랜드명 또는 일부를 가린 이메일이에요. 테스트를 만들 때 저장할 워크스페이스를 고르거나 바꾸기 위해서예요. 브라우저의 사이트 데이터를 지우면 사라져요.</li>
          <li>참여 세션 식별값(sessionStorage): 참여 통계가 중복으로 잡히지 않게 하는 무작위 값이에요. 브라우저 탭을 닫으면 사라져요.</li>
          <li>연락처 제출 여부(sessionStorage): 참여자가 이 탭에서 이미 연락처를 남겼다는 표시(받은 결과와 받은 쿠폰 코드)예요. 테스트를 다시 해도 연락처를 또 묻지 않기 위해서예요. 연락처 자체는 저장하지 않으며, 브라우저 탭을 닫으면 사라져요.</li>
          <li>워크스페이스 전환 안내 닫음(sessionStorage): &lsquo;이 워크스페이스를 기본으로 쓰기&rsquo; 안내를 닫았다는 표시예요. 브라우저 탭을 닫으면 사라져요.</li>
        </ul>
        <p className="small muted">브라우저 설정에서 사이트 데이터 저장을 지우거나 막을 수 있으며, 막아도 관리 링크 주소로는 그대로 이용할 수 있습니다. 카카오톡 공유 기능이 있는 테스트 화면에서는 카카오(주)의 공유 스크립트를 불러오며, 공유 버튼을 누르면 공유할 테스트 정보가 카카오로 전달됩니다.</p>

        <h2 style={H2}>12. 안전성 확보 조치</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>모든 전송 구간 암호화(HTTPS)</li>
          <li>데이터베이스 외부 공개 접근 차단(행 수준 보안), 앱 전용 계정으로만 접속</li>
          <li>관리 링크 비밀값을 아는 사람만 대시보드에 접근</li>
          <li>접속 IP는 비밀 키로 만든 해시값으로만 저장하고 90일 뒤 삭제</li>
          <li>AI 운영자는 운영용 기능으로만 작업하며, 모든 쓰기 작업을 기록하고 기록에는 연락처를 가려서 남김</li>
          <li>관리 링크나 비밀값이 들어간 답변·메일은 운영 기능이 보내지 않도록 차단</li>
        </ul>

        <h2 style={H2}>13. 만 14세 미만 아동</h2>
        <p>서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 리드 입력 폼은 참여자가 만 14세 이상인지 확인합니다.</p>

        <h2 style={H2}>14. 개인정보 보호책임자</h2>
        {officer && officerEmail ? (
          <p>성명: {officer} · 이메일: <a href={`mailto:${officerEmail}`}>{officerEmail}</a>{BUSINESS.phone ? ` · 전화: ${BUSINESS.phone}` : ""}</p>
        ) : (
          <p>시행 전 초안이라 아직 지정되지 않았어요. 그동안 개인정보 관련 요청은 <Link href="/support">고객지원</Link>에서 &lsquo;개인정보·데이터 삭제&rsquo; 유형으로 보내 주세요.</p>
        )}

        <h2 style={H2}>15. 권익침해 구제 방법</h2>
        <p className="small">개인정보 침해에 대한 상담이나 구제가 필요하면 아래 기관에 문의할 수 있습니다.</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)</li>
          <li>개인정보침해신고센터: 118 (privacy.kisa.or.kr)</li>
          <li>대검찰청: 1301 (www.spo.go.kr)</li>
          <li>경찰청: 182 (ecrm.police.go.kr)</li>
        </ul>

        <h2 style={H2}>16. 방침의 변경</h2>
        <p>이 방침을 바꾸면 시행 7일 전(이용자 권리에 중요한 변경은 30일 전)부터 이 페이지에 알립니다.</p>
        <p className="small muted">시행일: {effective ?? "정해지지 않음(시행 전 초안)"}</p>
      </article>
    </div>
  );
}
