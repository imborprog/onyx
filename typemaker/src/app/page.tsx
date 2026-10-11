import Link from "next/link";
import { BRAND, PRODUCTS } from "@/lib/config";
import { FAQ } from "@/lib/faq";
import { galleryTests, type GalleryItem } from "@/lib/repo";

export const dynamic = "force-dynamic";

const USE_CASES = [
  { who: "학원·교육", what: "\"나의 공부 유형 테스트\"로 설명회 전 상담 신청을 모아요." },
  { who: "카페·뷰티·필라테스", what: "결과마다 다른 쿠폰을 줘서 방문을 유도해요." },
  { who: "브랜드·쇼핑몰", what: "프로모션 시즌에 공유되는 이벤트 페이지를 10분 만에 열어요." },
  { who: "마케팅 대행사", what: "고객사마다 테스트를 찍어내고 성과 리포트를 바로 뽑아요." },
];

function won(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

export default async function Home() {
  let gallery: GalleryItem[] = [];
  try {
    gallery = await galleryTests(6);
  } catch {
    gallery = [];
  }
  return (
    <div className="container">
      <section className="hero">
        <span className="pill">크몽 외주 39만원 대신, AI로 10분</span>
        <h1>
          주제만 넣으면<br />
          <span className="stamp">공유되는 심리테스트</span>가<br />
          완성돼요
        </h1>
        <p className="lede">문항, 결과 유형, 공유 이미지를 AI가 만들고, 참여자 연락처 수집과 결과별 쿠폰까지 한 번에 붙여요.</p>
        <div className="row">
          <Link href="/create" className="btn btn-primary">무료로 테스트 만들기</Link>
          <Link href="/gallery" className="btn btn-ghost">예시 테스트 해 보기</Link>
        </div>
        <p className="tiny muted">회원가입 없이 바로 시작 · 무료 플랜은 결과 화면에 {BRAND.name} 표시</p>
      </section>

      <section className="section">
        <h2>이렇게 만들어요</h2>
        <div className="steps">
          <div className="card"><b>주제와 목적 입력</b><p className="muted small">"우리 카페 커피 취향", "신학기 공부 습관"처럼 한 줄이면 충분해요.</p></div>
          <div className="card"><b>AI가 초안 완성</b><p className="muted small">질문, 보기, 결과 설명, 결과별 공유 이미지까지 자동으로 만들어요.</p></div>
          <div className="card"><b>다듬고 발행</b><p className="muted small">문구를 고치고 리드 수집·쿠폰을 켠 뒤 링크를 공유하면 끝.</p></div>
        </div>
      </section>

      <section className="section">
        <h2>이런 곳에서 써요</h2>
        <div className="grid-2">
          {USE_CASES.map((u) => (
            <div key={u.who} className="card"><b>{u.who}</b><p className="muted small">{u.what}</p></div>
          ))}
        </div>
      </section>

      {gallery.length > 0 ? (
        <section className="section">
          <div className="row between">
            <h2>지금 인기 있는 테스트</h2>
            <Link href="/gallery" className="small">전체 보기</Link>
          </div>
          <div className="grid-3">
            {gallery.map((g) => (
              <Link key={g.slug} href={`/t/${g.slug}`} className="card" style={{ textDecoration: "none", borderTop: `6px solid ${g.accent}` }}>
                <b>{g.title}</b>
                <p className="muted small">{g.subtitle}</p>
                <p className="tiny muted num">{g.plays.toLocaleString("ko-KR")}명 참여</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <h2>요금</h2>
        <div className="grid-3">
          <div className="card stack"><b>무료</b><p className="display" style={{ fontSize: 28 }}>0원</p><p className="muted small">테스트 제작·발행, 결과 공유, 리드 20건 열람. 결과 화면에 {BRAND.name} 표시.</p></div>
          <div className="card stack" style={{ borderColor: "var(--accent)" }}><b>프로</b><p className="display" style={{ fontSize: 28 }}>{won(PRODUCTS.pro_month.amount)}<span className="small muted"> / 30일</span></p><p className="muted small">{PRODUCTS.pro_month.blurb}</p></div>
          <div className="card stack"><b>캠페인 패스</b><p className="display" style={{ fontSize: 28 }}>{won(PRODUCTS.campaign.amount)}</p><p className="muted small">{PRODUCTS.campaign.blurb}</p></div>
        </div>
        <Link href="/pricing" className="small">요금 자세히 보기</Link>
      </section>

      <section className="section">
        <h2>자주 묻는 질문</h2>
        <div className="stack">
          {FAQ.slice(0, 5).map((f) => (
            <details key={f.q} className="card card-tight">
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{f.q}</summary>
              <p className="muted small" style={{ marginTop: 8 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section center">
        <h2>첫 테스트는 무료예요</h2>
        <div><Link href="/create" className="btn btn-primary">지금 만들기</Link></div>
      </section>
    </div>
  );
}
