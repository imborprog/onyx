import type { Metadata } from "next";
import Link from "next/link";
import { galleryTests } from "@/lib/repo";

export const metadata: Metadata = { title: "심리테스트 모음", description: "지금 가장 많이 하는 무료 심리테스트·유형 테스트 모음" };
export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const items = await galleryTests(60);
  return (
    <div className="container" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <div className="stack">
          <h1 className="display" style={{ fontSize: 34 }}>심리테스트 모음</h1>
          <p className="muted">해 보고 마음에 들면, 우리 브랜드 버전도 10분 만에 만들 수 있어요.</p>
        </div>
        {items.length === 0 ? <p className="muted">곧 테스트가 올라와요.</p> : (
          <div className="grid-3">
            {items.map((g) => (
              <Link key={g.slug} href={`/t/${g.slug}`} className="card stack" style={{ textDecoration: "none", borderTop: `6px solid ${g.accent}`, gap: 6 }}>
                <b style={{ fontSize: 18 }}>{g.title}</b>
                <span className="muted small">{g.subtitle}</span>
                <span className="tiny muted num">{g.plays.toLocaleString("ko-KR")}명 참여</span>
              </Link>
            ))}
          </div>
        )}
        <div className="card row between">
          <span><b>우리 가게·브랜드 테스트도 만들어 볼까요?</b><br /><span className="small muted">결과마다 쿠폰을 주고 상담 신청을 모을 수 있어요.</span></span>
          <Link href="/create" className="btn btn-primary">무료로 만들기</Link>
        </div>
      </div>
    </div>
  );
}
