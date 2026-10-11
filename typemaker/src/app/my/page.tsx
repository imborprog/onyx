"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { knownWorkspaces, switchWorkspace, workspaceLabel, type KnownWorkspace } from "@/components/WorkspaceBits";
import { getSavedWorkspace } from "@/lib/client";

export default function MyPage() {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "missing" } | { kind: "pick"; list: KnownWorkspace[]; current: string | null }>({ kind: "loading" });
  useEffect(() => {
    const list = knownWorkspaces();
    const only = list[0];
    if (list.length > 1) setState({ kind: "pick", list, current: getSavedWorkspace() });
    else if (only) router.replace(`/w/${only.secret}`);
    else setState({ kind: "missing" });
  }, [router]);

  if (state.kind === "pick") {
    return (
      <div className="narrow stack" style={{ paddingBlock: 48 }}>
        <h1 className="display" style={{ fontSize: 28 }}>어느 워크스페이스를 열까요?</h1>
        <p className="muted small">이 브라우저에서 쓴 워크스페이스예요. 고른 곳이 &lsquo;내 테스트&rsquo;와 새 테스트 만들기의 기본이 돼요.</p>
        <div className="stack">
          {state.list.map((w) => (
            <button
              key={w.secret}
              type="button"
              className="card card-tight row between"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                switchWorkspace(w.secret, w.label);
                router.push(`/w/${w.secret}`);
              }}
            >
              <span>{workspaceLabel(w)}</span>
              {w.secret === state.current ? <span className="pill gray">지금 기본</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="narrow center stack" style={{ paddingBlock: 64 }}>
      {state.kind === "missing" ? (
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
