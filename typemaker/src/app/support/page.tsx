import type { Metadata } from "next";
import { FAQ } from "@/lib/faq";
import { NewTicketForm } from "@/components/SupportForms";

export const metadata: Metadata = { title: "고객지원" };

export default function SupportPage() {
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <div className="stack">
          <h1 className="display" style={{ fontSize: 34 }}>무엇을 도와드릴까요?</h1>
          <p className="muted">남겨 주시면 AI가 먼저 답변하고, 환불·결제 취소·개인정보 삭제는 사람이 확인해요.</p>
        </div>
        <NewTicketForm />
        <div className="stack">
          <h2 style={{ fontSize: 20 }}>자주 묻는 질문</h2>
          {FAQ.map((f) => (
            <details key={f.q} className="card card-tight">
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{f.q}</summary>
              <p className="muted small" style={{ marginTop: 8 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
