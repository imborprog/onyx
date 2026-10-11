"use client";

import { useEffect, useState } from "react";
import { api, saveWorkspace } from "@/lib/client";

export function RememberWorkspace({ secret }: { secret: string }) {
  useEffect(() => saveWorkspace(secret), [secret]);
  return null;
}

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          })
          .catch(() => window.prompt("아래 링크를 복사하세요", text));
      }}
    >
      {done ? "복사됨" : label}
    </button>
  );
}

export function ProfileForm({ secret, email, brandName, marketingOptIn }: { secret: string; email: string; brandName: string; marketingOptIn: boolean }) {
  const [e, setE] = useState(email);
  const [b, setB] = useState(brandName);
  const [m, setM] = useState(marketingOptIn);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (ev) => {
        ev.preventDefault();
        try {
          await api("/api/workspace", { method: "PATCH", workspace: secret, body: { email: e, brandName: b, marketingOptIn: m } });
          setMsg("저장했어요");
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "저장하지 못했어요");
        }
      }}
    >
      <div className="grid-2">
        <div className="field">
          <label htmlFor="ws-email">이메일</label>
          <input id="ws-email" type="email" className="input" value={e} onChange={(x) => setE(x.target.value)} placeholder="관리 링크 분실 시 본인 확인용" />
        </div>
        <div className="field">
          <label htmlFor="ws-brand">브랜드 이름</label>
          <input id="ws-brand" className="input" value={b} onChange={(x) => setB(x.target.value)} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={m} onChange={(x) => setM(x.target.checked)} />
        <span>(선택) 새 기능·할인 소식 이메일 받기</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-dark btn-sm">저장</button>
        {msg ? <span className="small muted">{msg}</span> : null}
      </div>
    </form>
  );
}
