"use client";

import { useEffect, useState } from "react";
import { api, getSavedWorkspace, saveWorkspace } from "@/lib/client";

// ---------------------------------------------------------------- workspaces this browser knows
//
// client.ts keeps one "current" workspace, which /my, /create, checkout and support use.
// Opening someone else's /w/ link must never replace it silently (their dashboard would then
// receive this person's new tests, leads and payments), so other workspaces are only added
// here, and only become current when the person says so.

const KNOWN_KEY = "typemaker.workspaces";
const DISMISS_KEY = "typemaker.workspace-switch-dismissed";

export interface KnownWorkspace {
  secret: string;
  /** Brand name or masked email; empty when this browser never saw the dashboard. */
  label: string;
}

function readKnown(): KnownWorkspace[] {
  try {
    const raw = window.localStorage.getItem(KNOWN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.flatMap((x: unknown): KnownWorkspace[] => {
      if (!x || typeof x !== "object") return [];
      const { secret, label } = x as Record<string, unknown>;
      return typeof secret === "string" && /^[a-f0-9]{20,64}$/.test(secret) ? [{ secret, label: typeof label === "string" ? label : "" }] : [];
    });
  } catch {
    return [];
  }
}

function writeKnown(list: KnownWorkspace[]): void {
  try {
    window.localStorage.setItem(KNOWN_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* private mode: only the current workspace is remembered */
  }
}

/** Every workspace this browser has used, the current one first. */
export function knownWorkspaces(): KnownWorkspace[] {
  const list = readKnown();
  const current = getSavedWorkspace();
  if (!current) return list;
  const mine = list.find((w) => w.secret === current) ?? { secret: current, label: "" };
  return [mine, ...list.filter((w) => w.secret !== current)];
}

/** Adds or relabels a workspace in the list. An empty label never overwrites a known one. */
export function rememberWorkspace(secret: string, label: string): void {
  const list = readKnown();
  const prev = list.find((w) => w.secret === secret);
  writeKnown([{ secret, label: label || prev?.label || "" }, ...list.filter((w) => w.secret !== secret)]);
}

/** Makes `secret` the current workspace, keeping the previous one in the list. */
export function switchWorkspace(secret: string, label: string): void {
  const current = getSavedWorkspace();
  if (current && current !== secret) rememberWorkspace(current, "");
  rememberWorkspace(secret, label);
  saveWorkspace(secret);
}

export function workspaceLabel(w: KnownWorkspace): string {
  return `${w.label || "이름 없는 워크스페이스"} (…${w.secret.slice(-4)})`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/**
 * Remembers the dashboard being viewed. The first workspace in a browser becomes current;
 * a different one only after the person confirms, since the link may be someone else's.
 */
export function RememberWorkspace({ secret, brandName, email }: { secret: string; brandName: string | null; email: string | null }) {
  const [current, setCurrent] = useState<KnownWorkspace | null>(null);
  // This browser already switched to this workspace once, so it is the person's own: a short note is enough.
  const [familiar, setFamiliar] = useState(false);
  const [switched, setSwitched] = useState(false);
  const label = brandName?.trim() || (email ? maskEmail(email) : "");

  useEffect(() => {
    const saved = getSavedWorkspace();
    if (!saved || saved === secret) {
      saveWorkspace(secret);
      rememberWorkspace(secret, label);
      setCurrent(null);
      return;
    }
    // Already known here (the person switched to it before): keep its label fresh, still don't switch.
    const known = readKnown().some((w) => w.secret === secret);
    if (known) rememberWorkspace(secret, label);
    setFamiliar(known);
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(DISMISS_KEY) === secret;
    } catch {
      /* ignore */
    }
    if (!dismissed) setCurrent(knownWorkspaces()[0] ?? { secret: saved, label: "" });
  }, [secret, label]);

  if (switched) return <div className="notice" role="status">이 브라우저의 &lsquo;내 테스트&rsquo;가 이제 이 워크스페이스로 열려요. 이전 워크스페이스는 테스트 만들기 화면에서 고를 수 있어요.</div>;
  if (!current) return null;
  const makeDefault = () => {
    switchWorkspace(secret, label);
    setCurrent(null);
    setSwitched(true);
  };
  if (familiar) {
    return (
      <div className="notice row between" role="status" style={{ gap: 8 }}>
        <span className="small">지금 &lsquo;내 테스트&rsquo;와 새 테스트 만들기는 {workspaceLabel(current)}로 연결돼요.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={makeDefault}>이 워크스페이스를 기본으로</button>
      </div>
    );
  }
  return (
    <div className="notice stack" role="status" style={{ gap: 8 }}>
      <b>이 브라우저에는 다른 워크스페이스가 저장돼 있어요: {workspaceLabel(current)}</b>
      <span className="small">
        &lsquo;내 테스트&rsquo;, 새 테스트 만들기, 결제는 지금도 그 워크스페이스로 연결돼요. 이 관리 링크가 내 것이 맞을 때만 바꿔 주세요.
        다른 사람에게 받은 링크라면 바꾸지 마세요. 내가 만든 테스트와 결제가 그 사람의 워크스페이스로 들어가요.
      </span>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-dark btn-sm" onClick={makeDefault}>이 워크스페이스를 기본으로 쓰기</button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            try {
              window.sessionStorage.setItem(DISMISS_KEY, secret);
            } catch {
              /* ignore */
            }
            setCurrent(null);
          }}
        >
          그대로 두기
        </button>
      </div>
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setBusy(true);
        try {
          await api("/api/workspace", { method: "PATCH", workspace: secret, body: { email: e, brandName: b, marketingOptIn: m } });
          setMsg("저장했어요");
          if (getSavedWorkspace() === secret || readKnown().some((w) => w.secret === secret)) rememberWorkspace(secret, b.trim() || (e ? maskEmail(e.trim()) : ""));
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "저장하지 못했어요");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid-2">
        <div className="field">
          <label htmlFor="ws-email">이메일</label>
          <input id="ws-email" type="email" className="input" value={e} onChange={(x) => setE(x.target.value)} placeholder="관리 링크 분실 시 본인 확인용" maxLength={120} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="ws-brand">브랜드 이름</label>
          <input id="ws-brand" className="input" value={b} onChange={(x) => setB(x.target.value)} maxLength={40} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={m} onChange={(x) => setM(x.target.checked)} />
        <span>(선택) 새 기능·할인 소식 이메일 받기</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        {msg ? <span className="small muted" role="status">{msg}</span> : null}
      </div>
    </form>
  );
}
