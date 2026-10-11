"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSavedWorkspace } from "@/lib/client";

export default function MyPage() {
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const s = getSavedWorkspace();
    if (s) router.replace(`/w/${s}`);
    else setMissing(true);
  }, [router]);
  return (
    <div className="narrow center stack" style={{ paddingBlock: 64 }}>
      {missing ? (
        <>
          <h1 className="display" style={{ fontSize: 28 }}>이 브라우저에 저장된 테스트가 없어요</h1>
          <p className="muted">테스트를 만든 기기에서 열거나, 관리 링크를 잃어버렸다면 고객지원에 남겨 주세요.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/create" className="btn btn-primary">새로 만들기</Link>
            <Link href="/support" className="btn btn-ghost">관리 링크 찾기</Link>
          </div>
        </>
      ) : <div className="spinner" aria-label="불러오는 중" />}
    </div>
  );
}
