import Link from "next/link";

export default async function CheckoutFailPage({ searchParams }: { searchParams: Promise<{ code?: string; message?: string }> }) {
  const { code, message } = await searchParams;
  return (
    <div className="narrow center stack" style={{ paddingBlock: 64 }}>
      <h1 className="display" style={{ fontSize: 28 }}>결제가 취소됐어요</h1>
      <p className="muted">{message ?? "결제를 완료하지 못했어요."}{code ? ` (${code})` : ""}</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/pricing" className="btn btn-primary">다시 결제하기</Link>
        <Link href="/support" className="btn btn-ghost">문의하기</Link>
      </div>
    </div>
  );
}
