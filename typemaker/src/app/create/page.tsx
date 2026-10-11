import type { Metadata } from "next";
import { aiEnabled } from "@/lib/config";
import CreateForm from "@/components/CreateForm";

export const metadata: Metadata = { title: "테스트 만들기" };
export const dynamic = "force-dynamic";

export default function CreatePage() {
  return (
    <div className="narrow" style={{ paddingBlock: "40px" }}>
      <div className="stack-lg">
        <div className="stack">
          <h1 className="display" style={{ fontSize: 34 }}>어떤 테스트를 만들까요?</h1>
          <p className="muted">주제 한 줄만 써도 돼요. 나머지는 고르기만 하면 {aiEnabled() ? "AI가 초안을 만들어요" : "초안이 바로 만들어져요"}.</p>
        </div>
        <CreateForm aiEnabled={aiEnabled()} />
      </div>
    </div>
  );
}
