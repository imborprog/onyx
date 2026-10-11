import Link from "next/link";

export default function NotFound() {
  return (
    <div className="narrow center stack" style={{ paddingBlock: 80 }}>
      <h1 className="display" style={{ fontSize: 30 }}>페이지를 찾을 수 없어요</h1>
      <p className="muted">링크가 바뀌었거나 발행이 중지된 테스트일 수 있어요.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/gallery" className="btn btn-ghost">다른 테스트 보기</Link>
        <Link href="/" className="btn btn-primary">홈으로</Link>
      </div>
    </div>
  );
}
