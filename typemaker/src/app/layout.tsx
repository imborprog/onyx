import type { Metadata, Viewport } from "next";
import { Do_Hyeon } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { appUrl, BRAND, BUSINESS } from "@/lib/config";

const doHyeon = Do_Hyeon({ weight: "400", subsets: ["latin"], variable: "--font-dohyeon", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: `${BRAND.name} — AI 브랜드 심리테스트 메이커`, template: `%s | ${BRAND.name}` },
  description: "주제만 입력하면 AI가 공유하고 싶은 심리테스트를 만들어 드려요. 결과 공유, 리드 수집, 쿠폰 발급까지 한 번에.",
  openGraph: { siteName: BRAND.name, locale: "ko_KR", type: "website" },
};

export const viewport: Viewport = { themeColor: "#f4f6fb", width: "device-width", initialScale: 1 };

function Footer() {
  const b = BUSINESS;
  const bizLine = [
    b.companyName && `상호 ${b.companyName}`,
    b.ceo && `대표 ${b.ceo}`,
    b.registrationNo && `사업자등록번호 ${b.registrationNo}`,
    b.mailOrderNo && `통신판매업 ${b.mailOrderNo}`,
    b.address && b.address,
    b.phone && `고객센터 ${b.phone}`,
  ].filter(Boolean);
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="row">
          <Link href="/legal/terms">이용약관</Link>
          <Link href="/legal/privacy"><b>개인정보처리방침</b></Link>
          <Link href="/support">고객지원</Link>
          <Link href="/contact">도입 문의</Link>
        </div>
        {bizLine.length > 0 ? <p>{bizLine.join(" · ")}</p> : <p>사업자 정보 준비 중</p>}
        {BRAND.supportEmail ? <p>이메일 {BRAND.supportEmail}</p> : null}
        <p>© {new Date().getFullYear()} {BRAND.name}</p>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={doHyeon.variable}>
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="logo" aria-label={`${BRAND.name} 홈`}>
              <span className="logo-mark" aria-hidden="true">유</span>
              {BRAND.name}
            </Link>
            <nav className="nav" aria-label="주요 메뉴">
              <Link href="/gallery" className="hide-sm">갤러리</Link>
              <Link href="/pricing">요금</Link>
              <Link href="/my" className="hide-sm">내 테스트</Link>
              <Link href="/create" className="btn btn-primary btn-sm" style={{ color: "#fff" }}>무료로 만들기</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
