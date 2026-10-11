import type { Metadata } from "next";
import { BRAND, BUSINESS } from "@/lib/config";

export const metadata: Metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  const owner = BUSINESS.companyName || BRAND.name;
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <article className="stack">
        <h1 className="display" style={{ fontSize: 32 }}>개인정보처리방침</h1>
        <p className="notice">초안입니다. 사업자 정보와 개인정보 보호책임자를 채우고 법률 검토를 거친 뒤 시행하세요.</p>
        <p>{owner}(이하 &ldquo;회사&rdquo;)는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보처리방침을 둡니다.</p>

        <h2 style={{ fontSize: 20 }}>1. 처리하는 개인정보와 목적</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>구분</th><th>항목</th><th>목적</th><th>보유 기간</th></tr></thead>
          <tbody>
            <tr><td>테스트 제작자</td><td>이메일(선택), 브랜드명(선택), 접속 IP의 해시값</td><td>관리 링크 발송, 본인 확인, 부정 이용 방지</td><td>마지막 이용 후 1년</td></tr>
            <tr><td>광고성 정보 수신 동의자</td><td>이메일</td><td>새 기능·할인 안내</td><td>동의 철회 시까지</td></tr>
            <tr><td>문의·도입 상담</td><td>이름, 이메일, 회사명, 연락처, 문의 내용</td><td>문의 답변, 계약 상담</td><td>처리 완료 후 1년</td></tr>
            <tr><td>유료 결제</td><td>이메일, 주문 정보(카드 정보는 결제대행사가 처리)</td><td>결제, 영수증·세금계산서 발행</td><td>전자상거래법에 따라 5년</td></tr>
            <tr><td>테스트 참여자</td><td>참여 기록(선택한 결과, 접속 세션 식별값)</td><td>통계</td><td>2년</td></tr>
          </tbody>
        </table></div>

        <h2 style={{ fontSize: 20 }}>2. 테스트 참여자가 남긴 연락처(리드)</h2>
        <p>테스트 제작자가 리드 수집 기능을 켠 경우, 참여자가 입력한 이름·연락처·이메일은 해당 <b>테스트 제작자가 개인정보처리자</b>로서 수집합니다. 회사는 제작자의 위탁을 받아 저장·보관하는 수탁자이며, 제작자가 정한 보관 기간이 지나면 자동으로 파기합니다. 참여자는 해당 테스트 제작자 또는 회사 고객지원을 통해 열람·삭제를 요청할 수 있습니다.</p>

        <h2 style={{ fontSize: 20 }}>3. 처리 위탁 및 국외 이전</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>수탁자</th><th>업무</th><th>이전 국가</th></tr></thead>
          <tbody>
            <tr><td>Supabase Inc.</td><td>데이터베이스 보관</td><td>대한민국 리전(서버 위치) / 미국 법인</td></tr>
            <tr><td>Vercel Inc.</td><td>웹 서비스 호스팅</td><td>미국 등</td></tr>
            <tr><td>Anthropic PBC</td><td>AI 문항 생성·자동 답변 (입력한 주제·문의 내용)</td><td>미국</td></tr>
            <tr><td>Resend</td><td>이메일 발송</td><td>미국</td></tr>
            <tr><td>토스페이먼츠(주)</td><td>결제 처리</td><td>대한민국</td></tr>
          </tbody>
        </table></div>
        <p className="small muted">국외 이전은 서비스 이용 시점에 네트워크를 통해 이루어지며, 이전을 원하지 않으면 서비스 이용을 중단하고 삭제를 요청할 수 있습니다.</p>

        <h2 style={{ fontSize: 20 }}>4. 이용자의 권리</h2>
        <p>이용자는 언제든 개인정보 열람·정정·삭제·처리정지와 광고성 정보 수신 철회를 요청할 수 있습니다. 고객지원 페이지에서 &lsquo;개인정보·데이터 삭제&rsquo; 유형으로 요청하면 지체 없이 처리합니다.</p>

        <h2 style={{ fontSize: 20 }}>5. 파기</h2>
        <p>보유 기간이 끝난 개인정보는 복구할 수 없는 방법으로 지체 없이 삭제합니다.</p>

        <h2 style={{ fontSize: 20 }}>6. 안전성 확보 조치</h2>
        <p>전송 구간 암호화(HTTPS), 데이터베이스 접근 통제, 관리 링크 기반 접근 제어, 접속 IP의 단방향 해시 저장을 적용합니다.</p>

        <h2 style={{ fontSize: 20 }}>7. 개인정보 보호책임자</h2>
        <p>성명: {BUSINESS.ceo || "(입력 필요)"} · 연락처: {BRAND.supportEmail || BUSINESS.phone || "(입력 필요)"}</p>
        <p className="small muted">시행일: 서비스 공개일</p>
      </article>
    </div>
  );
}
